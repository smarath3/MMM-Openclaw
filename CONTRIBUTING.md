# Contributing to MMM-Openclaw

Thanks for your interest in contributing! This project connects MagicMirror² to OpenClaw, and there's plenty of room to improve it.

## Getting Started

1. Fork the repo and clone it locally
2. Run `./scripts/setup-mac.sh` to set up the development environment
3. Start the mock gateway and MagicMirror with `./scripts/dev.sh --mock`
4. Make your changes and test locally before submitting a PR

## What You Can Contribute

### Skills
The easiest way to contribute — add new OpenClaw skills in the `skills/` directory. Follow the [SKILL.md format](https://docs.openclaw.ai/tools/skills) with YAML frontmatter and clear natural-language instructions.

### Module Features
Improvements to the MagicMirror module itself (`MMM-Openclaw/`):
- New themes
- Better streaming display
- Additional cross-module notifications
- Accessibility improvements

### Documentation
- Setup guides for different hardware configurations
- Troubleshooting tips
- Translations

## Code Style

- 2-space indentation
- ES6+ JavaScript (MagicMirror modules run in Electron)
- Descriptive variable names
- Comments for non-obvious logic

## Pull Request Process

1. Create a feature branch from `main`
2. Keep PRs focused — one feature or fix per PR
3. Test with the mock gateway at minimum
4. Update README or docs if your change affects setup or usage
5. Describe what you changed and why in the PR description

## Reporting Issues

When filing an issue, include:
- Your hardware setup (Pi model, display, mic)
- MagicMirror version
- OpenClaw version
- Relevant logs from `pm2 logs MagicMirror` or browser DevTools

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
