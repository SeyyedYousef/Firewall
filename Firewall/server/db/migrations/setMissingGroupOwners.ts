import { prisma } from "../client.js";
import { logger } from "../../utils/logger.js";

/**
 * Migration script to set missing group owners
 * This script attempts to get chat administrators and set the creator as the owner
 */
export async function setMissingGroupOwners(telegram: any): Promise<void> {
  logger.info("Starting migration: setMissingGroupOwners");
  
  try {
    // Find all groups without an owner
    const groupsWithoutOwner = await prisma.group.findMany({
      where: {
        ownerId: null,
        status: {
          not: "removed",
        },
      },
      select: {
        id: true,
        telegramChatId: true,
        title: true,
      },
    });

    logger.info(`Found ${groupsWithoutOwner.length} groups without owner`);

    let successCount = 0;
    let failCount = 0;

    for (const group of groupsWithoutOwner) {
      try {
        // Try to get chat administrators
        const admins = await telegram.getChatAdministrators(group.telegramChatId);
        
        // Find the creator
        const creator = admins.find((admin: any) => admin.status === "creator");
        
        if (creator && creator.user?.id) {
          const creatorTelegramId = creator.user.id.toString();
          
          // Ensure user exists
          const user = await prisma.user.upsert({
            where: { telegramId: creatorTelegramId },
            update: {},
            create: {
              telegramId: creatorTelegramId,
              role: "user",
            },
          });

          // Update group owner
          await prisma.group.update({
            where: { id: group.id },
            data: {
              ownerId: user.id,
            },
          });

          logger.info(`Set owner for group ${group.title}`, {
            chatId: group.telegramChatId,
            ownerId: creatorTelegramId,
          });
          
          successCount++;
        } else {
          logger.warn(`No creator found for group ${group.title}`, {
            chatId: group.telegramChatId,
          });
          failCount++;
        }
      } catch (error) {
        logger.warn(`Failed to set owner for group ${group.title}`, {
          chatId: group.telegramChatId,
          error,
        });
        failCount++;
      }
    }

    logger.info("Migration completed", {
      total: groupsWithoutOwner.length,
      success: successCount,
      failed: failCount,
    });
  } catch (error) {
    logger.error("Migration failed", { error });
    throw error;
  }
}
