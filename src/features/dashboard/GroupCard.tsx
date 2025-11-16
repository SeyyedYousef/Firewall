import { Avatar, Button, Card, Text, Title } from "@telegram-apps/telegram-ui";

import { classNames } from "@/css/classnames.ts";
import { formatDaysLeft, formatMembersCount, formatNumber } from "@/utils/format.ts";

import type { ManagedGroup } from "./types.ts";

import styles from "./GroupCard.module.css";

type GroupCardProps = {
  group: ManagedGroup;
  onOpenSettings?: (group: ManagedGroup) => void;
  onRenew?: (group: ManagedGroup) => void;
};

function initialsFromTitle(title: string): string {
  const words = title.trim().split(/\s+/).filter(Boolean);
  if (!words.length) {
    return "?";
  }
  const [first, second] = words;
  if (!second) {
    return words[0].charAt(0).toUpperCase();
  }
  return `${first.charAt(0)}${second.charAt(0)}`.toUpperCase();
}

export function GroupCard({ group, onOpenSettings, onRenew }: GroupCardProps) {
  const { status } = group;

  let statusLabel: string;
  let statusClassName = styles.statusNeutral;
  let showRenew = false;
  let removalHint: string | undefined;

  if (status.kind === "active") {
    statusLabel = `Credits: ${formatDaysLeft(status.daysLeft)}`;
    statusClassName = styles.statusPositive;
  } else if (status.kind === "expired") {
    statusLabel = "Credits expired";
    statusClassName = styles.statusNegative;
    showRenew = true;
  } else {
    const remainingDays = Math.max(
      0,
      Math.ceil((new Date(status.graceEndsAt).getTime() - Date.now()) / 86_400_000)
    );
    statusLabel = "The bot is no longer managing this group.";
    statusClassName = styles.statusRemoved;
    removalHint = `You have ${formatNumber(remainingDays)} day(s) to re-add the bot.`;
  }



  const disabled = status.kind === "removed" || !group.canManage;

  return (
    <Card
      className={classNames(
        styles.card,
        status.kind === "removed" && styles.cardRemoved,
        status.kind === "expired" && styles.cardExpired
      )}
      type="plain"
    >
      <div className={styles.content} dir="ltr">
        <div className={styles.topRow}>
          <Avatar
            size={48}
            src={group.photoUrl ?? undefined}
            acronym={group.photoUrl ? undefined : initialsFromTitle(group.title)}
            alt={group.title}
          />
          <div className={styles.details}>
            <Title level="3" className={styles.title}>
              {group.title}
            </Title>
            <Text className={styles.meta} weight="2">
              {formatMembersCount(group.membersCount)}
            </Text>
          </div>
        </div>
        <div className={styles.statusRow}>
          <Text className={classNames(styles.status, statusClassName)} weight="2">
            {statusLabel}
          </Text>
          {showRenew && onRenew && (
            <Button
              size="s"
              mode="filled"
              className={styles.renewButton}
              onClick={() => onRenew(group)}
            >
              Renew subscription
            </Button>
          )}
        </div>
        <Button
          size="m"
          mode="outline"
          stretched
          className={styles.manageButton}
          onClick={() => onOpenSettings?.(group)}
          disabled={disabled}
        >
          Manage settings
        </Button>
        {removalHint && (
          <Text className={styles.removalHint} weight="2">
            {removalHint}
          </Text>
        )}
      </div>
    </Card>
  );
}

