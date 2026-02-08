# Git + GitHub Setup Guide for MMM-Openclaw

## Step-by-step: From local files to published GitHub repo

### 1. Create the GitHub repository (browser)

Go to https://github.com/new and create:

- **Repository name:** `MMM-Openclaw`
- **Description:** `MagicMirror² module for OpenClaw AI assistant — family briefings, task management, and study companion`
- **Visibility:** Public
- **Do NOT** initialize with README, .gitignore, or license (we have these already)
- Click **Create repository**

GitHub will show you the "quick setup" page. Copy the HTTPS or SSH URL:
```
# SSH (recommended if you have SSH keys set up):
git@github.com:smarath3/MMM-Openclaw.git

# HTTPS:
https://github.com/smarath3/MMM-Openclaw.git
```

### 2. Initialize local git and push (terminal)

```bash
# Navigate to your project directory
cd ~/projects/MMM-Openclaw

# If not already a git repo:
git init
git branch -M main

# Stage all files
git add -A

# Verify what's being committed (no secrets!)
git status
# Make sure .env is NOT listed (only .env.example should be)

# Initial commit
git commit -m "feat: initial MMM-Openclaw module with OpenClaw skills

- MagicMirror module with OpenClaw Gateway WebSocket integration
- Three display themes (default, minimal, briefing)
- Four OpenClaw skills (family-briefing, task-manager, study-companion, magic-mirror)
- Mac development scripts (setup, dev runner, Pi deploy)
- Mock gateway for local testing
- Cross-module notification system"

# Add the GitHub remote
git remote add origin git@github.com:smarath3/MMM-Openclaw.git

# Push
git push -u origin main
```

### 3. Verify on GitHub

Visit `https://github.com/smarath3/MMM-Openclaw` — you should see the
README rendered with badges.

### 4. Add GitHub topics (browser)

On the repo page, click the gear icon next to "About" and add topics:
```
magicmirror, openclaw, smart-mirror, ai-assistant, raspberry-pi,
magic-mirror-module, clawdbot, home-automation
```

These help people discover your project.

---

## Ongoing workflow: Making changes and pushing

### Feature branch workflow (recommended)

```bash
# Create a branch for your feature
git checkout -b feat/voice-integration

# Make changes...
# Edit files, test locally with ./scripts/dev.sh --mock

# Stage and commit
git add -A
git commit -m "feat: add voice input support via OpenClaw Talk Mode"

# Push the branch
git push -u origin feat/voice-integration

# On GitHub: create a Pull Request from feat/voice-integration → main
# After review/merge, clean up:
git checkout main
git pull
git branch -d feat/voice-integration
```

### Quick fix workflow (for small changes)

```bash
# For small fixes, you can commit directly to main
git add -A
git commit -m "fix: handle gateway reconnect on network change"
git push
```

### Commit message convention

Use conventional commits for clean history:

```
feat: add something new
fix: fix a bug
docs: update documentation
style: CSS/formatting changes (no logic change)
refactor: restructure code (no behavior change)
skill: add or update an OpenClaw skill
chore: maintenance (deps, scripts, CI)
```

Examples:
```
feat: add streaming response display with live text updates
fix: reconnect to gateway after Pi wakes from sleep
docs: add hardware setup guide for ReSpeaker mic
skill: add recipe-helper skill for kitchen display
chore: update ws dependency to 8.19.0
```

---

## GitHub repository settings (optional but recommended)

### Branch protection (Settings → Branches)
- Protect `main` branch
- Require PR reviews before merging (even if it's just you, it's good practice)

### GitHub Actions (CI) — future addition
You could add `.github/workflows/lint.yml` to run ESLint on PRs:

```yaml
name: Lint
on: [push, pull_request]
jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm install
      - run: npx eslint . --ext .js
```

### Releases
When you reach a milestone:
```bash
git tag -a v0.1.0 -m "Initial release"
git push origin v0.1.0
```
Then create a Release on GitHub from the tag.

---

## SSH key setup (if not already done)

If you prefer SSH over HTTPS for GitHub:

```bash
# Generate a key (if you don't have one)
ssh-keygen -t ed25519 -C "your-email@example.com"

# Copy the public key
cat ~/.ssh/id_ed25519.pub | pbcopy

# Add to GitHub: Settings → SSH and GPG keys → New SSH key
# Paste and save

# Test
ssh -T git@github.com
# Should say: "Hi smarath3! You've successfully authenticated..."
```

---

## Checklist before first push

- [ ] `.gitignore` excludes `.env`, `node_modules/`, `.magicmirror-dev/`
- [ ] `.env.example` has no real secrets (only placeholder values)
- [ ] `LICENSE` file is present (MIT)
- [ ] `README.md` has your actual GitHub username (replace smarath3)
- [ ] All files use the new name `MMM-Openclaw` (not `MMM-Clawdbot`)
- [ ] `package.json` has correct name and description
- [ ] `scripts/*.sh` are executable (`chmod +x scripts/*.sh`)
- [ ] Mock gateway runs without errors: `node tools/mock-gateway.js`
