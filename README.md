# AutoWeave

<img src="assets/autoweave.svg" align="right" width="180" />

[![Static Badge](https://img.shields.io/badge/License-Sloxen™-darkgreen)]()
[![Static Badge](https://img.shields.io/badge/Build-Passing-%23a9f378)]()
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)]()
[![JavaScript](https://img.shields.io/badge/JavaScript-Vanilla-orange.svg)]()
[![Status](https://img.shields.io/badge/Project-Active-brightgreen.svg)]()

![Org](https://img.shields.io/badge/Research-Sloxen™-black)
[![Platform](https://img.shields.io/badge/Platform-Web%20%7C%20WIN%20%7C%20Linux%20%7C%20WSL%20%7C%20macOS-lightgrey)]()

**AutoWeave** is developed and maintained by **Sloxen™**. It is a deterministic, browser-first **CSV merge + ETL** tool designed for real-world operational datasets (time logs, income records, project lists) that arrive **asynchronously** and inconsistently.

AutoWeave focuses on **reproducibility, auditability, and low-friction workflows**: validate → normalise → merge → deduplicate → summarise → visualise → export.

🌐 Website: https://autoweave.sloxen.com

---

# Contents
- [Features](#Features)
- [Architecture](#Architecture)
  - [Tech Stack](#Tech-Stack)
- [Local Development](#Local-Development)
  - [Clone the repository](#Clone-the-repository)
  - [Run a local static server](#Run-a-local-static-server)
- [Data Contracts](#Data-Contracts)
  - [Time](#Time)
  - [Income](#Income)
  - [Projects](#Projects)
- [Merge & Validation Rules](#Merge--Validation-Rules)
- [Quick Stats & Visualisations](#Quick-Stats--Visualisations)
- [Build & Deploy](#Build--Deploy-GitHub-Pages)
- [Roadmap](#Roadmap)
- [Contribution](#Contribution)
- [License](#License)
- [Links](#Links)

---

# Features

## Guided Merge (Deterministic ETL)

* Upload **time**, **income**, and **project** CSV files
* Validate schema before processing
* Normalise dates, ids, and numeric fields
* Deterministic join keys (no fuzzy matching)
* Deduplicate merged output
* Export a clean merged dataset

## Quick Stats

* Row count
* Total time
* Total income
* Income/hour
* Project-level summaries:
  * total time
  * total income
  * income/hour

## Visual Overview

* Stacked daily charts (date on x-axis)
  * Time by project
  * Income by project
  * Income/hour by project
* Floating legend (AutoTrac-style)
* Designed to be R-style readable: structured tables + consistent scales

## Demo Mode (Auto-load)

* Auto-loads sample datasets from:

  * `assets/technology/time_sample.csv`
  * `assets/technology/income_sample.csv`
  * `assets/technology/project_sample.csv`

* User uploads override demo data.

---

# Architecture

AutoWeave frontend:

```
├── AutoWeave
│   ├── index.html
│   ├── tech.html
│   ├── script.js
│   ├── autoweave.svg
│   └── assets
│       └── technology
│           ├── time_sample.csv
│           ├── income_sample.csv
│           └── project_sample.csv
└── README.md
```

## Tech Stack

**Frontend**

* HTML + CSS
* Vanilla JavaScript
* CSV parsing (client-side)
* Browser rendering for tables + charts

**Backend**

* Backend: FastAPI (validation + persistence)
* Database: PostgreSQL (versioned datasets + lineage)

---

# Data Contracts

AutoWeave expects three datasets: **time**, **income**, and **projects** (optional).

## Time

Required columns:

* `project_id` (string)
* `work_date` (date; ISO preferred)

Recommended columns (used to compute/validate duration):

* `start_time` (time)
* `end_time` (time)
* `duration` (number; hours or minutes depending on your export — AutoWeave normalises to hours)

## Income

Required columns:

* `project_id` (string)
* `work_date` (date)
* `income` (number)

## Projects

Required columns:

* `project_id` (string)
* `project` (string; display name)

---

# Merge & Validation Rules

## Normalisation

* Trim whitespace on all identifiers
* Coerce numeric fields (`income`, `duration`)
* Normalise `work_date` to a consistent date key
* Treat missing values explicitly (no silent inference)

## Invalid Time Rows

* Drop time entries where **both** `start_time` and `end_time` are missing/unparseable **and** `duration` is missing/unparseable.

## Join Strategy

Deterministic join key:

```
project_id + work_date
```

Income aligns to time entries by exact match on this key.

## Deduplication

Merged output is deduplicated using a deterministic composite key (implementation-defined), typically:

```
project_id + work_date + duration + income
```

AutoWeave does **not** perform fuzzy matching.

---

# Quick Stats & Visualisations

## Quick Stats

Computed from the merged dataset:

* Total rows
* Total time
* Total income
* Income per hour
* By-project summaries:
  * total time
  * total income
  * income per hour

## Visualisations

Stacked daily charts:

* Time by project
* Income by project
* Income/hour by project

All charts:

* Use a consistent project color mapping
* Include a floating legend
* Default to most recent dates available in the merged dataset

---

# Roadmap

- export audit metadata
- predictive hooks (AutoPred)

---

# Contribution

Maintained by [**Sloxen™ GitHub**](https://github.com/sloxen), and [**Daddy Sloth GitHub**](https://github.com/drxilu).

---

# License

© 2026 **Sloxen™**.

A trading name of **Sloxen Ltd**
Registered in England and Wales (Company No. 16907507).

MIT License.

---

## Links

* [AutoWeave Website](https://autoweave.sloxen.com)
* [AutoWeave GitHub](https://github.com/sloxen/AutoWeave)
* [Company homepage](https://sloxen.com)

<p align="right">
  <a href="#top" style="text-decoration:none;">
    ⬆️
  </a>
</p>
