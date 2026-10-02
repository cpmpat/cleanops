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
| `owner.csv` | Owner (sheet-backed, view only) | FRONT_DESK_MANAGER, FRONT_DESK, EVIDENCE |

Owner still lives in the Google Sheet. Its field names are matched against
the sheet's header row (case and spacing ignored), and the dry run lists any
that match nothing. Edit grants on it are stored but act as view.
