# Access matrix files

One CSV per CDM list — who may view and who may edit each column, per role.
These files are the source of truth; the database (`dataset_field_access`)
is loaded from them:

```bash
cd backend
./scripts/prod.sh import:access-matrix -- --tenant prague-stays --dataset accommodation --csv ../docs/access-matrix/accommodation.csv           # dry run
./scripts/prod.sh import:access-matrix -- --tenant prague-stays --dataset accommodation --csv ../docs/access-matrix/accommodation.csv --apply
```

For the roles a file names, it is the whole truth (grants it no longer lists
are removed); roles it does not name are left alone. MANAGER and ADMIN were
seeded with view on every column by migration and are not in these files
unless added. Commit a changed file in the same PR as running it.

| File | List | Roles |
|---|---|---|
| `accommodation.csv` | Accommodation | FRONT_DESK_MANAGER, FRONT_DESK, EVIDENCE |
| `owner.csv` | Owner | FRONT_DESK_MANAGER, FRONT_DESK, EVIDENCE |
| `user.csv` | User | FRONT_DESK_MANAGER, FRONT_DESK, EVIDENCE, ADMIN |

**Row order = column order.** For the roles a file names, the order of the
field rows is the order of the columns they see in Data. Move a row to move
the column; `--skip-order` loads the grants without touching the order.

Owner lives in Postgres since 6 Oct 2026, like Accommodation.

Which *changes* a role is told about in Notifications → Data is a separate
file per list in `docs/notify-matrix/` (`import:notify-matrix`).
