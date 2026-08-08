# GitHub setup

## 1. Create a new repository

Recommended name:

`zreport-dual-dashboard`

Create it as an empty repository:

- Add README: **Off**
- Add .gitignore: **No .gitignore**
- License: **None**

## 2. Upload this package

Extract the ZIP and upload the extracted folders/files.

The critical structure is:

```text
.github/workflows/deploy-pages.yml
config/dashboard.config.json
data/<your Excel workbook>.xlsx
data/README.md
scripts/build.py
web/index.html
web/app.js
web/styles.css
README.md
GITHUB_WORKFLOW_COPY.txt
.gitignore
```

The `site` folder is intentionally not committed. It is generated automatically by GitHub Actions.

## 3. If Windows hides `.github`

Commit the other files first.

Then go to:

**Actions → New workflow → set up a workflow yourself**

Create:

`.github/workflows/deploy-pages.yml`

Copy the contents from `GITHUB_WORKFLOW_COPY.txt`, then commit.

## 4. Enable Pages

Go to:

**Settings → Pages → Build and deployment → Source → GitHub Actions**

## 5. Deploy

Go to **Actions → Deploy Z-Report Dual Dashboard**.

Wait for:

- build ✅
- deploy ✅

Then open the Pages URL.

# Monthly update

For future refreshes, only replace the workbook in `/data`.

The filename may change.

The dashboard automatically detects:

- outlets
- actual months
- new All Year month columns
- category mappings
- latest actual month
- the next projected month

No code editing is required as long as the workbook structure and respective headers/formulas remain consistent.
