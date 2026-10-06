# Notify matrix files

Which field changes each role is shown in **Notifications → Data**. One CSV
per CDM list; the database (`dataset_field_notify`) is loaded from them:

```bash
cd backend
./scripts/prod.sh import:notify-matrix -- --tenant prague-stays --dataset accommodation --csv ../docs/notify-matrix/accommodation.csv           # dry run
./scripts/prod.sh import:notify-matrix -- --tenant prague-stays --dataset accommodation --csv ../docs/notify-matrix/accommodation.csv --apply
```

Shape: `field,ADMIN,MANAGER,FRONT_DESK_MANAGER,EVIDENCE`, one row per field,
TRUE or FALSE. Any roles, any order. For the roles a file names it is the
whole truth; roles it does not name are left alone.

A change shows only if this file says TRUE **and** the access matrix lets the
role view the field — the dry run lists TRUEs that will show nothing for that
reason. Sensitive fields (passwords, IBAN, birth number) are recorded without
values and listed for ADMIN only, whatever the file says.

The starting files: ADMIN and MANAGER TRUE everywhere (as the migration
seeded them); FRONT_DESK_MANAGER and EVIDENCE TRUE on exactly the columns they
may view — turn off what they do not need before loading.
