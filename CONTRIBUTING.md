# Contributing to Sparky

Thanks for your interest in contributing! This guide will help you get started.

## Getting Started

1. Fork and clone the repo:
   ```bash
   git clone https://github.com/<your-username>/sparky.git
   cd sparky
   ```

2. Install prerequisites:
   - [Node.js 18+](https://nodejs.org/)
   - [Rust (stable)](https://rustup.rs/)

3. Install dependencies and start the dev server:
   ```bash
   npm install
   npm run tauri dev
   ```

## Development Workflow

1. Create a feature branch from `main`:
   ```bash
   git checkout -b feature/my-change
   ```

2. Make your changes.

3. Run checks before committing:
   ```bash
   npx tsc --noEmit                              # TypeScript
   cargo check --manifest-path src-tauri/Cargo.toml  # Rust
   npm test                                       # Tests
   ```

4. Commit with a descriptive message and push:
   ```bash
   git commit -m "Add feature X"
   git push -u origin feature/my-change
   ```

5. Open a pull request against `main`.

## Project Structure

See [docs/architecture.md](docs/architecture.md) for a detailed overview. Key directories:

- `src/` — React frontend (components, data layer, LLM integration)
- `src-tauri/src/` — Rust backend (Tauri commands, tool sandbox, proxies)
- `docs/` — Project documentation

## Adding a New LLM Provider

See the step-by-step checklist in [CLAUDE.md](CLAUDE.md#adding-a-new-provider).

## Code Style

- TypeScript strict mode — no unused imports or variables
- Keep PRs focused — one feature or fix per PR
- Prefer editing existing files over creating new ones
- Add tests for new data layer logic when the test suite is available

## Reporting Issues

Use [GitHub Issues](https://github.com/datashaman/sparky/issues). Include:

- What happened
- What you expected
- Steps to reproduce
- Browser/OS if relevant

## License

By contributing, you agree that your contributions will be licensed under the [Apache License 2.0](LICENSE).
