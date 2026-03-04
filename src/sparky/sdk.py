import logging

from claude_agent_sdk import (
    ClaudeAgentOptions,
    ClaudeSDKClient,
    AssistantMessage,
    ResultMessage,
    TextBlock,
    ToolUseBlock,
    create_sdk_mcp_server,
)

logger = logging.getLogger("sparky")

MODEL = "claude-sonnet-4-6"


async def run_agent(
    *,
    agent_name: str,
    system_prompt: str,
    user_message: str,
    tools: list,
    allowed_tools: list,
    max_turns: int = 10,
) -> None:
    """Run a single agent call via ClaudeSDKClient with logging."""
    server = create_sdk_mcp_server(
        name=f"{agent_name}-tools", version="1.0.0", tools=tools
    )

    options = ClaudeAgentOptions(
        model=MODEL,
        system_prompt=system_prompt,
        mcp_servers={"tools": server},
        allowed_tools=allowed_tools,
        max_turns=max_turns,
    )

    logger.info("[%s] starting", agent_name)
    logger.debug("[%s] system: %s", agent_name, system_prompt[:200])
    logger.debug("[%s] user: %s", agent_name, user_message[:300])

    async with ClaudeSDKClient(options=options) as client:
        await client.query(user_message)

        async for msg in client.receive_messages():
            if isinstance(msg, AssistantMessage):
                for block in msg.content:
                    if isinstance(block, TextBlock):
                        logger.info("[%s] %s", agent_name, block.text)
                    elif isinstance(block, ToolUseBlock):
                        logger.info(
                            "[%s] tool_use: %s(%s)",
                            agent_name, block.name, block.input,
                        )
            elif isinstance(msg, ResultMessage):
                logger.info(
                    "[%s] done — %d turns, %dms, cost=$%s",
                    agent_name,
                    msg.num_turns,
                    msg.duration_ms or 0,
                    f"{msg.total_cost_usd:.4f}" if msg.total_cost_usd else "?",
                )
                break
