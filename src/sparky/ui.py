import asyncio
import contextvars
import copy
import logging

from rich.text import Text

from textual.app import App, ComposeResult
from textual.binding import Binding
from textual.containers import Horizontal, VerticalScroll
from textual.message import Message
from textual.screen import ModalScreen
from textual.widgets import (
    DataTable, Footer, Header, Input, RichLog, Rule, Static,
    TabbedContent, TabPane,
)

from sparky.models import Bug, Story

current_ticket_id: contextvars.ContextVar[str] = contextvars.ContextVar("current_ticket_id")

# Jira status category IDs define the canonical order.
# 1 = "No Category" / "Undefined", 2 = "To Do", 4 = "In Progress", 3 = "Done"
DEFAULT_CATEGORY_ORDER = {1: 0, 2: 1, 4: 2, 3: 3}


def _sort_key(item: Story | Bug) -> tuple[int, str]:
    """Sort by category order, then status name."""
    display = getattr(item, "_display", {})
    category_id: int = display.get("category_id", 999)
    order = DEFAULT_CATEGORY_ORDER.get(category_id, 100 + category_id)
    status = display.get("status", "")
    return (order, status)


class DetailScreen(ModalScreen[None]):
    """Modal overlay showing work item details."""

    BINDINGS = [
        Binding("escape", "close_detail", "Close", show=True),
        Binding("enter", "close_detail", "Close", show=False),
        Binding("h", "close_detail", "Close", show=False),
    ]

    CSS = """
    DetailScreen {
        align: center middle;
    }
    #detail-panel {
        width: 80%;
        height: 80%;
        background: $surface;
        border: thick $accent;
        padding: 0 2;
    }
    #detail-title {
        text-style: bold;
        width: 100%;
        padding: 0;
    }
    #detail-item-title {
        width: 100%;
        padding: 1 0 0 0;
        text-style: bold;
    }
    .field-row {
        height: auto;
        width: 100%;
        padding: 0;
    }
    .field-label {
        width: 14;
        text-style: bold;
        color: $text-muted;
    }
    .field-value {
        width: 1fr;
    }
    #detail-description {
        padding: 0;
        width: 100%;
        color: $text-muted;
    }
    """

    def __init__(self, item: Story | Bug) -> None:
        super().__init__()
        self._item = item

    def compose(self) -> ComposeResult:
        item = self._item
        kind = "Bug" if isinstance(item, Bug) else "Story"
        display = getattr(item, "_display", {})

        with VerticalScroll(id="detail-panel"):
            yield Static(f"[bold]{item.id}[/bold] {kind}", id="detail-title", markup=True)
            url = display.get("url")
            if url:
                title_text = Text(item.title)
                title_text.stylize(f"link {url}")
                yield Static(title_text, id="detail-item-title")
            else:
                yield Static(item.title, id="detail-item-title", markup=False)
            yield Rule()

            fields: list[tuple[str, str]] = []
            if display.get("category"):
                fields.append(("Category", display["category"]))
            if display.get("status"):
                fields.append(("Status", display["status"]))
            if item.priority:
                fields.append(("Priority", item.priority))
            if isinstance(item, Bug) and item.environment:
                fields.append(("Environment", item.environment))

            for label, value in fields:
                with Horizontal(classes="field-row"):
                    yield Static(f"{label}", classes="field-label", markup=True)
                    yield Static(f"{value}", classes="field-value", markup=False)

            yield Rule()
            yield Static(item.description or "(no description)", id="detail-description", markup=False)

    def action_close_detail(self) -> None:
        self.dismiss(None)


class IssueSelector(App[list]):
    """Interactive issue selector using a single DataTable sorted by category."""

    TITLE = "Sparky — Select Issues"

    BINDINGS = [
        Binding("j", "cursor_down", "Down", show=False),
        Binding("k", "cursor_up", "Up", show=False),
        Binding("l", "show_detail", "Detail", show=False),
        Binding("space", "toggle_select", "Toggle", show=True),
        Binding("c", "confirm", "Confirm", show=True),
        Binding("q", "cancel", "Quit", show=True),
        Binding("escape", "cancel", "Cancel", show=False),
        Binding("a", "select_all", "All", show=True),
        Binding("n", "select_none", "None", show=True),
    ]

    CSS = """
    DataTable > .datatable--cursor {
        background: $accent;
    }
    """

    def __init__(self, items: list[Story | Bug]) -> None:
        super().__init__()
        self._items = items
        self._sorted_indices = [i for i, _ in sorted(enumerate(items), key=lambda t: _sort_key(t[1]))]
        self._selected: set[int] = set()

    def compose(self) -> ComposeResult:
        yield Header()
        yield DataTable(cursor_type="row", zebra_stripes=True)
        yield Footer()

    def on_mount(self) -> None:
        table = self.query_one(DataTable)
        table.add_column(" ", width=3, key="check")
        table.add_column("ID", key="id")
        table.add_column("Type", key="type")
        table.add_column("Category", key="category")
        table.add_column("Status", key="status")
        table.add_column("Title", key="title")

        for orig_idx in self._sorted_indices:
            item = self._items[orig_idx]
            kind = "Bug" if isinstance(item, Bug) else "Story"
            display = getattr(item, "_display", {})
            url = display.get("url")
            if url:
                title_cell = Text(item.title)
                title_cell.stylize(f"link {url}")
            else:
                title_cell = Text(item.title)
            table.add_row(
                "[ ]",
                item.id,
                kind,
                display.get("category", ""),
                display.get("status", ""),
                title_cell,
                key=str(orig_idx),
            )

    def _current_row_key(self) -> str | None:
        table = self.query_one(DataTable)
        if table.row_count == 0:
            return None
        key = table.coordinate_to_cell_key(table.cursor_coordinate).row_key
        return key.value if key is not None else None

    def _toggle_row(self, row_key_str: str) -> None:
        table = self.query_one(DataTable)
        idx = int(row_key_str)
        if idx in self._selected:
            self._selected.discard(idx)
            table.update_cell(row_key_str, "check", "[ ]")
        else:
            self._selected.add(idx)
            table.update_cell(row_key_str, "check", "[X]")

    def action_cursor_down(self) -> None:
        table = self.query_one(DataTable)
        table.action_cursor_down()

    def action_cursor_up(self) -> None:
        table = self.query_one(DataTable)
        table.action_cursor_up()

    def action_show_detail(self) -> None:
        row_key = self._current_row_key()
        if row_key is not None:
            item = self._items[int(row_key)]
            self.push_screen(DetailScreen(item))

    def on_data_table_row_selected(self, event: DataTable.RowSelected) -> None:
        self.action_confirm()

    def action_toggle_select(self) -> None:
        row_key = self._current_row_key()
        if row_key is not None:
            self._toggle_row(row_key)

    def action_select_all(self) -> None:
        table = self.query_one(DataTable)
        for idx in self._sorted_indices:
            if idx not in self._selected:
                self._selected.add(idx)
                table.update_cell(str(idx), "check", "[x]")

    def action_select_none(self) -> None:
        table = self.query_one(DataTable)
        for idx in list(self._selected):
            self._selected.discard(idx)
            table.update_cell(str(idx), "check", "[ ]")

    def action_confirm(self) -> None:
        result = [self._items[i] for i in sorted(self._selected)]
        self.exit(result)

    def action_cancel(self) -> None:
        self.exit([])


# ---------------------------------------------------------------------------
# Workflow TUI — tabbed concurrent display
# ---------------------------------------------------------------------------


class WorkflowLog(Message):
    """Carries a log line from a workflow task to the UI."""

    def __init__(self, ticket_id: str, text: str) -> None:
        super().__init__()
        self.ticket_id = ticket_id
        self.text = text


class HITLRequest(Message):
    """Carries a HITL escalation from a workflow task to the UI."""

    def __init__(self, ticket_id: str, prompt: str, future: asyncio.Future[str]) -> None:
        super().__init__()
        self.ticket_id = ticket_id
        self.prompt = prompt
        self.future = future


class TicketRoutingHandler(logging.Handler):
    """Logging handler that routes records to the WorkflowApp by ticket ID."""

    def __init__(self, app: "WorkflowApp") -> None:
        super().__init__()
        self._app = app

    def emit(self, record: logging.LogRecord) -> None:
        try:
            ticket_id = current_ticket_id.get()
        except LookupError:
            return
        text = self.format(record)
        self._app.post_message(WorkflowLog(ticket_id, text))


class WorkflowApp(App[None]):
    """Tabbed TUI showing concurrent workflow progress per ticket."""

    TITLE = "Sparky — Workflows"

    BINDINGS = [
        Binding("q", "quit", "Quit", show=True),
    ]

    CSS = """
    RichLog {
        height: 1fr;
    }
    .hitl-input {
        display: none;
        dock: bottom;
        height: 3;
        padding: 0 1;
    }
    .hitl-input.visible {
        display: block;
    }
    @keyframes tab-flash {
        0% { color: $warning; text-style: bold; }
        50% { color: $text; text-style: none; }
        100% { color: $warning; text-style: bold; }
    }
    .needs-attention {
        animation: tab-flash 1s infinite;
    }
    """

    def __init__(self, items: list[Story | Bug]) -> None:
        super().__init__()
        self._items = items
        self._handler: TicketRoutingHandler | None = None
        self._console_handler: logging.Handler | None = None
        self._active = 0
        self._tasks: list[asyncio.Task] = []
        self._hitl_futures: dict[str, asyncio.Future[str]] = {}

    def compose(self) -> ComposeResult:
        yield Header()
        with TabbedContent():
            for item in self._items:
                kind = "Bug" if isinstance(item, Bug) else "Story"
                with TabPane(f"{item.id} {kind}", id=f"tab-{item.id}"):
                    yield RichLog(id=f"log-{item.id}", wrap=True, markup=True)
                    yield Input(
                        placeholder="approve / reject / note",
                        id=f"hitl-{item.id}",
                        classes="hitl-input",
                    )
        yield Footer()

    def on_mount(self) -> None:
        import sparky.hitl
        sparky.hitl._workflow_app = self

        logger = logging.getLogger("sparky")

        # Suppress the console handler while TUI is active
        for h in logger.handlers:
            if isinstance(h, logging.StreamHandler) and not isinstance(h, logging.FileHandler):
                self._console_handler = h
                logger.removeHandler(h)
                break

        # Install routing handler
        self._handler = TicketRoutingHandler(self)
        self._handler.setLevel(logging.INFO)
        self._handler.setFormatter(logging.Formatter("%(name)s  %(message)s"))
        logger.addHandler(self._handler)

        # Launch workflows concurrently
        for item in self._items:
            self._active += 1
            ctx = copy.copy(contextvars.copy_context())
            ctx.run(current_ticket_id.set, item.id)
            task = asyncio.get_running_loop().create_task(
                self._run_workflow(item), context=ctx,
            )
            self._tasks.append(task)

    async def _run_workflow(self, item: Story | Bug) -> None:
        from sparky.workflows.bug import run_bug_workflow
        from sparky.workflows.story import run_story_workflow

        ticket_id = item.id
        try:
            if isinstance(item, Bug):
                completed = await run_bug_workflow(item)
            else:
                completed = await run_story_workflow(item)
            self.post_message(
                WorkflowLog(ticket_id, f"\n[bold green]Done:[/] {completed.id} — {completed.status}")
            )
        except asyncio.CancelledError:
            return
        except Exception as exc:
            self.post_message(
                WorkflowLog(ticket_id, f"\n[bold red]Error:[/] {exc}")
            )
        finally:
            self._active -= 1
            if self._active <= 0:
                self.post_message(
                    WorkflowLog(ticket_id, "\n[bold]All workflows complete. Press q to quit.[/]")
                )

    def on_workflow_log(self, event: WorkflowLog) -> None:
        try:
            rich_log = self.query_one(f"#log-{event.ticket_id}", RichLog)
            rich_log.write(event.text)
        except Exception:
            pass

    def on_hitl_request(self, event: HITLRequest) -> None:
        ticket_id = event.ticket_id
        self._hitl_futures[ticket_id] = event.future

        # Show the HITL prompt in the log
        rich_log = self.query_one(f"#log-{ticket_id}", RichLog)
        rich_log.write(f"\n[bold yellow]HITL:[/] {event.prompt}")

        # Show the input widget and focus it
        inp = self.query_one(f"#hitl-{ticket_id}", Input)
        inp.add_class("visible")

        # Flash the tab header
        tab_id = f"--content-tab-tab-{ticket_id}"
        try:
            tab = self.query_one(f"#{tab_id}")
            tab.add_class("needs-attention")
        except Exception:
            pass

        # Switch to the tab needing attention and focus the input
        tabbed = self.query_one(TabbedContent)
        tabbed.active = f"tab-{ticket_id}"
        inp.focus()

    def on_input_submitted(self, event: Input.Submitted) -> None:
        input_id = event.input.id
        if not input_id or not input_id.startswith("hitl-"):
            return
        ticket_id = input_id.removeprefix("hitl-")
        decision = event.value.strip() or "approve"

        # Hide the input
        event.input.remove_class("visible")
        event.input.value = ""

        # Log the decision
        try:
            rich_log = self.query_one(f"#log-{ticket_id}", RichLog)
            rich_log.write(f"[bold]Decision:[/] {decision}")
        except Exception:
            pass

        # Stop flashing the tab
        tab_id = f"--content-tab-tab-{ticket_id}"
        try:
            tab = self.query_one(f"#{tab_id}")
            tab.remove_class("needs-attention")
        except Exception:
            pass

        # Resolve the future to unblock the workflow
        future = self._hitl_futures.pop(ticket_id, None)
        if future and not future.done():
            future.set_result(decision)

    def on_unmount(self) -> None:
        import sparky.hitl
        sparky.hitl._workflow_app = None

        # Cancel any pending HITL futures
        for future in self._hitl_futures.values():
            if not future.done():
                future.cancel()
        self._hitl_futures.clear()

        for task in self._tasks:
            if not task.done():
                task.cancel()
        self._tasks.clear()
        logger = logging.getLogger("sparky")
        if self._handler:
            logger.removeHandler(self._handler)
            self._handler = None
        if self._console_handler:
            logger.addHandler(self._console_handler)
            self._console_handler = None
