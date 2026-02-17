-- CreateTable
CREATE TABLE "leads_clean" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "email" TEXT NOT NULL,
    "firstName" TEXT,
    "gender" TEXT,
    "sourceCampaignTag" TEXT NOT NULL,
    "verifiedStatus" TEXT,
    "verifiedAt" DATETIME,
    "manyreachCampaignId" TEXT,
    "pushedToManyReach" BOOLEAN NOT NULL DEFAULT false,
    "pushedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Settings" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "leads_clean_email_key" ON "leads_clean"("email");
