BULK ACTION PLATFORM FOR A CRM

Shipmnts technical assignment.

This is a backend that runs bulk actions on CRM records. The first action is bulk update: you send a list of contacts with the fields to change, either as JSON or as a file (CSV or Excel .xlsx). The API replies straight away with an action ID, and the work then runs in the background in batches. Every record ends up as success, failed or skipped, and each one gets its own log line saying why.

Built with Node 20, TypeScript, Express 5, PostgreSQL (through Prisma), and Redis with BullMQ for the queues.


1. WHAT WAS ASKED, AND WHERE IT'S COVERED

- Bulk update on an entity, many fields at once: POST /bulk-actions with actionType "bulk_update". Each record has an id plus any of name, email, age, status.
- Batch processing: records are split into batches of 1,000, and each batch is one SQL update.
- Large volumes: a single file can hold up to about a million records (MAX_UPLOAD_SIZE_MB, 100MB). CSV and XLSX uploads are streamed and read 5,000 rows at a time, so memory stays flat whatever the file size. Tested with 100k records in both formats.
- Thousands of entities per minute: the load test did 100,000 records in 18.3 seconds, about 327,000 a minute (section 6).
- Horizontal scaling: the API and the workers are separate processes with no state of their own. Start more of either.
- Logs for every entity: GET /bulk-actions/:id/logs gives one entry per record, filterable by status or contact ID.
- Stats endpoint: GET /bulk-actions/:id/stats returns total, success, failed, skipped and percent done.
- Status of queued, ongoing and completed actions: GET /bulk-actions?status=...
- Real-time progress: GET /bulk-actions/:id reads live counters, so you can poll it.
- Robust error handling: bad records fail on their own, failed batches are retried, and crashed workers hand their work to others. If Redis loses its queues, the workers rebuild them from the database (section 5).
- Easy to add new actions: one file per action plus one line to register it (section 8).
- Entity-agnostic: Contact is described by a small config file. A new entity is a new config, not new logic.
- Postman collection: postman/crm-bulk-actions.postman_collection.json, with tests on every request.
- De-duplication on email (optional): built. Duplicates are marked skipped in the logs.
- Per-account rate limiting (optional): design written up in section 7, not built.
- Scheduling (optional): design written up in section 7, not built.


2. RUNNING IT

You need Node 20 or newer, PostgreSQL, and Redis 6.2 or newer (BullMQ doesn't work on older Redis).

With Docker, "docker compose up -d" starts Postgres and Redis using the values in .env. Without Docker, a normal Postgres install works. On Windows, use Memurai as the Redis server.

Setup, in order:

- copy .env.example to .env, then set DATABASE_URL to your Postgres
- npm install (this also generates the Prisma client)
- npm run db:deploy (creates the tables)
- npm run db:seed -- 10000 (adds 10,000 sample contacts, ids 1 to 10000)

The same steps as commands:

    cp .env.example .env
    npm install
    npm run db:deploy
    npm run db:seed -- 10000

Then start the API and a worker, each in its own terminal. Start more workers to scale out.

    npm run dev:api
    npm run dev:worker

Then import the Postman collection and try the requests. The API runs on http://localhost:3000. A few things to know:

- The collection has four folders: Create, Read, Logs and Errors. Every request has tests, so you can also run the whole collection at once with Postman's runner.
- The JSON create request sends 5,000 records (contacts 1 to 5,000). Its first 10 rows show one of each outcome, and it gives 4,882 success, 51 failed, 67 skipped.
- The CSV and XLSX requests use files from the data/ folder. In Postman, set Settings > General > Working directory to this project folder, or pick the file again in the request's Body tab.
- Creating actions is limited to 20 a minute by default (CREATE_RATE_LIMIT_MAX). Running the whole collection several times in one minute will start returning 429.

Other commands:

- npm run build compiles to dist/. After that, npm run start:api and npm run start:worker run the compiled code (for production).
- npm run typecheck checks types across the whole project.
- npm run load-test -- 100000 runs the end-to-end load test (section 6).

Every setting lives in .env, and .env.example explains each one. The app checks them on startup and stops with a clear message if one is missing or wrong. One rule it checks: PLANNER_CHUNK_SIZE has to be a multiple of BATCH_SIZE (the defaults are 5000 and 1000). Fixed values such as statuses, queue names and messages are in src/config/constants.ts.


3. HOW IT WORKS

The flow, from request to finished action:

    POST /bulk-actions
          |
          v
      API --> saves a bulk_actions row (status = queued)
          |
          v
      "bulk-planner" queue          one job per bulk action
          |
          v
      planner
       - reads records 5,000 at a time (json body, csv or xlsx file)
       - checks each record, marks duplicates as skipped
       - saves one log row per record
       - queues the valid rows in batches (rows 1-1000, 1001-2000, ...)
          |
          v
      "bulk-batches" queue          one job per batch
          |
          v
      batch workers (any number of processes)
       - update the whole batch with one SQL statement
       - mark each row success or failed, update the counters
          |
          v
      last batch to finish --> status = completed

      recovery check (every worker, on startup and every 5 minutes)
       - finds unfinished actions in postgres
       - puts back any planner or batch jobs that redis lost

In plain words:

1. The API only checks the outer shape of the request (account, entity type, action type). It saves one row, queues one job and replies with 202 Accepted. That takes milliseconds whatever the size.
2. The planner picks the job up and does the real checking, record by record. A bad record fails on its own and doesn't reject the whole request.
3. The planner splits the good records into batches and queues them. It starts queueing after the first 5,000 records, so workers begin almost immediately.
4. Batch workers pick up batches in parallel and write the changes to the database.
5. Counters on the action row are updated as each batch finishes. When the last one is done, the action is marked completed.
6. In the background, every worker checks the database now and then for actions that should be running but have no jobs in Redis, and queues their jobs again. Normally it finds nothing to do. It only matters if Redis loses its data.

Why two queues instead of one? One job holding millions of records couldn't be shared between workers, and a crash at 80% would mean starting again from zero. Splitting the work into many small batch jobs lets any worker pick up any batch, and a failed batch is retried on its own. The batch jobs only carry a row range (fromRow, toRow), so Redis stays small and the data stays in Postgres.

The database tables:

- contacts is the sample entity. Email is indexed but not unique, because real CRM data has duplicates.
- bulk_actions has one row per bulk action: its status, where the records came from (json, csv or xlsx), and the counters. Progress and stats only read this one row, so they're instant even for huge actions.
- bulk_action_items has one row per record sent. It holds the changes, the result and a message, and it doubles as the log. Logs are paged with a cursor instead of an offset, so the last page loads as fast as the first.


4. API

Base URL: http://localhost:3000

Errors always come back in the same shape:

    { "error": { "message": "Validation failed", "details": [{ "field": "accountId", "message": "Required" }] } }

Create a bulk action: POST /bulk-actions

As JSON, with up to 10,000 records (MAX_JSON_RECORDS):

    {
      "accountId": "acc_101",
      "entityType": "contact",
      "actionType": "bulk_update",
      "records": [
        { "id": 1, "status": "customer" },
        { "id": 3, "email": "pujan@something.com", "name": "Pujan M." },
        { "id": 7, "email": "Pujan@Something.com" }
      ]
    }

Or as a file upload (multipart/form-data) with the fields accountId, entityType, actionType and file. The file can be a .csv or an Excel .xlsx. Use a file for large updates: it goes straight to disk and is read in chunks, never loaded whole. The limit is 100MB (MAX_UPLOAD_SIZE_MB), which is about a million records; anything bigger gets 413.

For both formats:

- The first row is the header: id plus any of name, email, age, status.
- An empty cell means "leave this field as it is".
- Examples are in the data/ folder (see "Sample files" below).

Extra rules for .xlsx:

- Only the first sheet (the first tab in Excel) is read.
- Every cell is read as plain text, so it behaves exactly like the same value in a CSV. A number cell gives its number, a formula gives its result, rich text and hyperlinks give their text, and TRUE/FALSE cells give TRUE or FALSE.
- Dates are read as Excel's day number, not as a date. None of the contact fields are dates, so this doesn't matter today.
- The file itself is checked, not just its name. A file called .xlsx that isn't really a workbook gets a 400.

Rules for each record:

- id is required, plus at least one field to change
- name: text
- email: a valid email
- age: a number from 0 to 150
- status: one of lead, prospect, customer, inactive
- any other field fails that record

The response is 202 Accepted:

    {
      "data": {
        "id": "6f1c9a2e-...",
        "status": "queued",
        "sourceType": "json",
        "progress": { "total": 0, "success": 0, "failed": 0, "skipped": 0, "pending": 0, "percent": 0, "allRecordsRead": false }
      }
    }

Sample files (data/ folder)

- sample-update.csv and sample-update.xlsx: the same 14 rows in both formats, small enough to read by eye. Each gives 8 success, 4 failed, 2 skipped. The .xlsx uses real Excel cell types (numbers, rich text, a hyperlink, a formula) to show they're read as plain values.
- sample-10k-update.xlsx: 10,000 rows for contacts 1 to 10,000, so it works with the default npm run db:seed. Gives 9,762 success, 101 failed, 137 skipped, in about 2.5 seconds.
- sample-large-update.xlsx: 100,000 rows for contacts 1 to 100,000. Run npm run db:seed -- 100000 first. Gives 97,650 success, 1,059 failed, 1,291 skipped, in about 21 seconds.
- bad-columns.csv and not-really.xlsx: used by the Postman error examples (an unknown column, and a text file named .xlsx).

The two big files are realistic: each row changes a random mix of fields and leaves the rest empty. About 2% of rows have a problem on purpose: the same email as an earlier row (with different capitals), the same contact twice, a contact that doesn't exist, an invalid email, an age over 150, or an unknown status. The logs show each one with its own reason. Their text is stored the way Excel stores it (a shared strings table), and they're generated from a fixed seed, so the results above are the same every time.

List bulk actions: GET /bulk-actions

Newest first. Optional filters: status (queued, in_progress, completed, failed), accountId, page, limit.

One bulk action with live progress: GET /bulk-actions/:id

Poll this to show a progress bar. allRecordsRead stays false while a file is still being read, because the total can still grow until then.

Summary stats: GET /bulk-actions/:id/stats

    { "data": { "id": "...", "status": "completed", "total": 11, "success": 7, "failed": 2, "skipped": 2, "pending": 0, "percent": 100, "allRecordsRead": true } }

Logs: GET /bulk-actions/:id/logs

One entry per record. Optional filters: status (pending, success, failed, skipped), entityId, limit. For the next page, pass the nextCursor value from the response as cursor.

    {
      "data": [
        { "row": 4, "entityId": 999999, "status": "failed", "message": "contact not found", "data": { "status": "customer" }, "processedAt": "..." },
        { "row": 7, "entityId": 7, "status": "skipped", "message": "duplicate email, same as row 2", "data": { "email": "pujan@something.com" }, "processedAt": "..." }
      ],
      "nextCursor": null
    }


5. DESIGN DETAILS

De-duplication

This runs in the planner, before anything is split into batches. That way two workers running at the same time can never both apply the same email.

- Records are read in order, and the first one for a given email or contact ID wins.
- A later record with the same email is skipped, with a message like "duplicate email, same as row 2".
- A later record for the same contact ID is skipped too.
- Emails are trimmed and lower-cased before comparing, so Pujan@Something.com matches pujan@something.com.
- Records from earlier chunks are already in the database, so each chunk is checked against them using two unique indexes. The lookup checks each key on its own, which keeps it fast however many records are already saved.
- The order is always the same, so the result is the same on every run, retries included.

The field used for this comes from the entity config (dedupeField: 'email' in src/entities/contact.ts).

What happens when things go wrong

- A batch fails: it's retried with a growing delay between attempts (JOB_ATTEMPTS, JOB_BACKOFF_MS). A batch only touches rows that are still pending, and it saves everything in one transaction, so a retry can't count anything twice.
- One bad row in a batch: if a row's data breaks the batch query, that batch is re-run one row at a time. The bad row is marked failed with the database's reason, and the others go through.
- Database or network hiccups: lost connections, deadlocks and timeouts aren't blamed on the data. The whole batch is retried.
- Out of retries: the batch's remaining rows are marked failed, so the action still finishes instead of hanging.
- Planner crashes part-way: on retry it skips the chunks it already saved and only re-queues their batches. Job IDs are fixed, so nothing is queued twice.
- A worker process dies: BullMQ notices the job stalled and gives it to another worker.
- Two batches finish at the same moment: the counter update locks the action row, so only the last one to commit marks the action completed.
- Redis loses its data: see the next part.

If Redis loses its data

Redis only holds the to-do list (the jobs). Everything that matters lives in Postgres: every action, every record, and the status of every row. So if Redis is flushed, or restarts without having saved to disk, the jobs disappear but nothing is actually lost. For example, say 3 requests were sent, 2 were still waiting in the planner queue, and then Redis was wiped and the worker restarted. Without recovery, those 2 would stay "queued" forever. With it, they run as normal.

How recovery works:

- Every worker runs a recovery check when it starts, and then every RECOVERY_INTERVAL_MS (5 minutes by default).
- It looks in Postgres for actions that are still queued or in progress.
- If an action hadn't finished planning, its planner job is queued again. The planner skips the chunks it already saved and carries on from there.
- If an action had finished planning, batch jobs are queued again, but only for the rows still pending.

Why it never does the same work twice:

- Each batch covers a fixed range of rows (1-1000, 1001-2000, and so on), so a batch always gets the same job ID. If the job is still in Redis, BullMQ ignores the second copy.
- A batch only touches rows that are still pending, so running one again changes nothing.
- If Redis is wiped while a planner is still running, recovery can start a second planner for the same action. Both can't save the same chunk: the database rejects the duplicate rows, and the planner that loses simply moves on to the next chunk.
- A batch's rows always come from one planner chunk, which is why PLANNER_CHUNK_SIZE has to be a multiple of BATCH_SIZE.

How it was tested. I wiped every queue key in Redis in three situations:

- 3 actions waiting in the queue with no worker running, then started the worker. All 3 finished.
- In the middle of a 100,000-row run, with the worker killed as well, then restarted it. All 100,000 rows were processed, each exactly once.
- In the middle of a 100,000-row run with the worker left running. The timed check put the jobs back and the action finished.

In all three, the action's counters matched the real row statuses exactly. A fourth test did the same mid-run wipe with an XLSX upload, and it also finished with every row counted once. Recovery is the safety net. The first line of defence is running Redis so it doesn't lose data in the first place (section 10).

How .xlsx files are read

An .xlsx file is a zip of XML files. The reader (src/utils/xlsx.ts) opens the zip through its table of contents, so the order of files inside it doesn't matter. It reads which sheet is the first tab, then the shared strings table, then streams that sheet's XML one row at a time. Each row becomes plain text, so from there on an XLSX record goes through exactly the same steps as a CSV one: validation, de-duplication, batches, retries and recovery.

I first used the exceljs streaming reader, but on valid workbooks it failed about 3 times in 10 with a crash inside the library, when xl/workbook.xml came last in the zip (which is how exceljs itself and some other tools save files). The reader now uses unzipper and saxes, which exceljs depends on anyway. exceljs is still used, only to write test files. After the switch, 120 reads in a row had no failures, including a hand-built workbook using the less common parts of the format: prefixed tags, the first tab not being sheet1, inline text, booleans and cells without positions.

One limit of the format: text cells point into a shared strings table that's stored separately from the sheet, so the whole table has to be held in memory while the file is read. For a million rows of mostly unique names and emails, that's a few hundred MB on the worker. CSV has no such table, so for the very largest uploads CSV is the lighter choice.

Scaling

The API and the workers run as separate processes and don't keep anything in memory between requests. You can run as many of each as you need, all pointed at the same Postgres and Redis. The API rate limiter also keeps its counts in Redis, so the limit holds across every API instance.

Each worker process handles BATCH_CONCURRENCY batches at once. The real limit is how fast Postgres can write, and every running batch uses one database connection. Set connection_limit in DATABASE_URL to at least PLANNER_CONCURRENCY + BATCH_CONCURRENCY plus a few spare, and keep the total across all processes under Postgres's max_connections.


6. PERFORMANCE

I ran npm run load-test with a 100,000-row CSV against 100,000 seeded contacts. About 1% of the rows had duplicate emails and 0.5% had invalid emails. One API process and one worker process, default settings (5 batches at a time, 1,000 rows per batch). Hardware: a Ryzen 5 2600 desktop with 16GB RAM, Windows, local Postgres 16 and Memurai.

- CSV, run 1: 18.3 seconds, about 327,000 records a minute. 98,535 success, 476 failed, 989 skipped.
- CSV, run 2: 18.3 seconds, about 327,000 records a minute, with a similar mix (the test data is random).
- XLSX, same 100,000 rows as a workbook: 22.5 seconds, about 267,000 records a minute. 98,497 success, 526 failed, 977 skipped. The worker's memory went from 228MB to a peak of 278MB during the run, so the sheet really is streamed. The workbook was 2.6MB, against 5.3MB for the same rows as CSV.

To run it yourself, with the API and a worker running:

    npm run db:seed -- 100000
    npm run load-test -- 100000
    npm run load-test -- 100000 xlsx

Reading and processing happen at the same time, so the total time is roughly whichever of the two is slower, not both added together. Right now the slower one is the planner saving each chunk of log rows. Memory use doesn't grow with the size of the action: the planner holds one chunk and a worker holds one batch.


7. OPTIONAL ENHANCEMENTS

De-duplication: built. See section 5.

Per-account rate limiting: designed, not built. Example limit: 10,000 records per minute per account.

- Every action already has an accountId, so each batch job would carry it too.
- Before running a batch, the worker adds the batch size to a Redis counter for that account and the current minute. The counter expires after 60 seconds.
- If that takes the account over its limit, the worker takes the count back and delays the job until the next minute (BullMQ's moveToDelayed). This doesn't count as a failed attempt.
- All workers share the same counter, so the limit holds however many workers are running. It also stops one big account from taking every worker while smaller accounts wait.

Scheduling: designed, not built. Example: an action that should start on 22 Nov at 11:15pm.

- Add an optional scheduledAt date to POST /bulk-actions (it must be in the future) and a new "scheduled" status.
- Queue the planner job with a delay of scheduledAt minus now. BullMQ keeps delayed jobs in Redis, so they survive restarts.
- At that time a worker picks it up and the normal flow runs.
- To cancel, remove the delayed job and mark the action cancelled.


8. ADDING NEW ACTIONS AND ENTITIES

A new action, for example bulk delete:

1. Create src/actions/bulk-delete.ts and export an object that matches the ActionHandler type in src/actions/types.ts. It needs a type, the requiredFields, getAllowedFields() (the fields a record may have), parseRecord() (checks one record) and applyBatch() (does the database work for one batch).
2. Register it in src/actions/index.ts.

The queues, planner, retries, de-duplication, logs and stats are shared, so nothing else changes.

A new entity, for example Company:

1. Add the model to prisma/schema.prisma.
2. Write a config like src/entities/contact.ts, matching the EntityConfig type: table name, the fields that can be updated (with their validation and SQL type) and the field to de-duplicate on.
3. Register it in src/entities/index.ts.


9. SECURITY

- helmet headers, CORS (CORS_ORIGIN), a size limit on JSON bodies, and a 100MB limit on uploads, which only accept .csv and .xlsx files. An .xlsx has to really be a zip workbook, not just be named like one.
- Every input is validated with zod. Only listed fields can be updated, and file headers are checked before anything is queued.
- All database queries use parameters. The batch update builds column names into the SQL, but they come from the entity config, never from the request.
- Rate limiting per IP, stored in Redis: RATE_LIMIT_MAX for all requests and a stricter CREATE_RATE_LIMIT_MAX for creating actions.
- Unexpected errors return a plain 500 and are logged on the server. Stack traces never reach the client.

Authentication was out of scope. In a real system, accountId would come from the logged-in user's token, not the request body.


10. BEFORE GOING TO PRODUCTION

- Run Redis with appendonly yes, so it writes every change to disk and keeps the queues across a restart. Also set maxmemory-policy noeviction, so Redis never drops jobs when it runs low on memory (BullMQ needs this).
- Uploaded files are saved to UPLOAD_DIR. If the API and workers run on different machines, this has to be shared storage, usually S3.
- bulk_action_items gets one row per record, roughly 100 to 200MB for a million-record action. A cleanup job or monthly partitions would let old logs be dropped cheaply.
- One file is capped at 100MB (about a million records). Bigger jobs can be split into several actions. The pipeline itself doesn't depend on the file size, so raising the cap means changing ENV_LIMITS.MAX_UPLOAD_SIZE_MB and making sure workers have the memory for large XLSX shared string tables.
- Once one Postgres server can't write any faster, more workers won't help. The next step would be a bigger database, or splitting the data across several.


11. PROJECT LAYOUT

    src/
      config/          env.ts (checked .env settings), constants.ts
      lib/             prisma, redis, logger (one shared instance each)
      queues/          bullmq queues and job types
      entities/        entity configs (contact.ts) and the EntityConfig type
      actions/         action handlers (bulk-update.ts) and the ActionHandler type
      modules/
        bulk-actions/  routes, controller, service, validation
      middlewares/     validation, upload, rate limit, error handling
      workers/         planner, batch worker, batch jobs, recovery, progress helpers, record reader
      types/           express request typing
      utils/           xlsx reader, file helpers, error helpers
      app.ts           express app
      server.ts        api entry point
      worker.ts        worker entry point
    prisma/            schema, migrations, seed script
    scripts/           load test
    data/              sample files: small .csv and .xlsx, 10k and 100k .xlsx, and two broken ones for the error examples
    postman/           postman collection, with tests on every request
