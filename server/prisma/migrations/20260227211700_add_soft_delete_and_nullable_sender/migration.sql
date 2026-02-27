-- AlterTable: Add isDeleted soft delete flag to users
ALTER TABLE "users" ADD COLUMN "isDeleted" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable: Make senderId nullable in messages (allow user deletion)
ALTER TABLE "messages" ALTER COLUMN "senderId" DROP NOT NULL;

-- DropForeignKey: Drop existing foreign key constraint
ALTER TABLE "messages" DROP CONSTRAINT "messages_senderId_fkey";

-- AddForeignKey: Re-add with ON DELETE SET NULL
ALTER TABLE "messages" ADD CONSTRAINT "messages_senderId_fkey" 
  FOREIGN KEY ("senderId") REFERENCES "users"("id") 
  ON DELETE SET NULL 
  ON UPDATE CASCADE;
