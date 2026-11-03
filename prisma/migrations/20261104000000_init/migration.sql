-- CreateEnum
CREATE TYPE "BulkActionStatus" AS ENUM ('queued', 'in_progress', 'completed', 'failed');

-- CreateEnum
CREATE TYPE "ItemStatus" AS ENUM ('pending', 'success', 'failed', 'skipped');

-- CreateEnum
CREATE TYPE "SourceType" AS ENUM ('json', 'csv');

-- CreateTable
CREATE TABLE "contacts" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "age" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'lead',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bulk_actions" (
    "id" UUID NOT NULL,
    "account_id" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "action_type" TEXT NOT NULL,
    "status" "BulkActionStatus" NOT NULL DEFAULT 'queued',
    "source_type" "SourceType" NOT NULL,
    "records" JSONB,
    "file_path" TEXT,
    "total_count" INTEGER NOT NULL DEFAULT 0,
    "success_count" INTEGER NOT NULL DEFAULT 0,
    "failed_count" INTEGER NOT NULL DEFAULT 0,
    "skipped_count" INTEGER NOT NULL DEFAULT 0,
    "is_planned" BOOLEAN NOT NULL DEFAULT false,
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bulk_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bulk_action_items" (
    "bulk_action_id" UUID NOT NULL,
    "row_number" INTEGER NOT NULL,
    "entity_id" INTEGER,
    "data" JSONB,
    "status" "ItemStatus" NOT NULL DEFAULT 'pending',
    "message" TEXT,
    "dedupe_key" TEXT,
    "dedupe_entity_id" INTEGER,
    "processed_at" TIMESTAMP(3),

    CONSTRAINT "bulk_action_items_pkey" PRIMARY KEY ("bulk_action_id","row_number")
);

-- CreateIndex
CREATE INDEX "contacts_email_idx" ON "contacts"("email");

-- CreateIndex
CREATE INDEX "contacts_status_idx" ON "contacts"("status");

-- CreateIndex
CREATE INDEX "bulk_actions_account_id_created_at_idx" ON "bulk_actions"("account_id", "created_at");

-- CreateIndex
CREATE INDEX "bulk_actions_status_created_at_idx" ON "bulk_actions"("status", "created_at");

-- CreateIndex
CREATE INDEX "bulk_action_items_bulk_action_id_status_row_number_idx" ON "bulk_action_items"("bulk_action_id", "status", "row_number");

-- CreateIndex
CREATE INDEX "bulk_action_items_bulk_action_id_entity_id_idx" ON "bulk_action_items"("bulk_action_id", "entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "bulk_action_items_bulk_action_id_dedupe_key_key" ON "bulk_action_items"("bulk_action_id", "dedupe_key");

-- CreateIndex
CREATE UNIQUE INDEX "bulk_action_items_bulk_action_id_dedupe_entity_id_key" ON "bulk_action_items"("bulk_action_id", "dedupe_entity_id");

-- AddForeignKey
ALTER TABLE "bulk_action_items" ADD CONSTRAINT "bulk_action_items_bulk_action_id_fkey" FOREIGN KEY ("bulk_action_id") REFERENCES "bulk_actions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
