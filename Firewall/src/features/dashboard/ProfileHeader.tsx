import { Avatar, Text, Title } from "@telegram-apps/telegram-ui";

import styles from "./ProfileHeader.module.css";

type ProfileHeaderProps = {
  displayName: string;
  username?: string | null;
  avatarUrl?: string | null;
};

function buildInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) {
    return "?";
  }
  const [first, second] = words;
  if (!second) {
    return words[0].charAt(0).toUpperCase();
  }
  return `${first.charAt(0)}${second.charAt(0)}`.toUpperCase();
}

export function ProfileHeader({ displayName, username, avatarUrl }: ProfileHeaderProps) {
  const acronym = buildInitials(displayName);

  return (
    <header className={styles.header} dir="ltr">
      <Avatar
        size={96}
        src={avatarUrl ?? undefined}
        acronym={avatarUrl ? undefined : acronym}
        alt={displayName}
      />
      <div className={styles.meta}>
        <Title className={styles.name} level="1">
          {displayName}
        </Title>
        <Text className={styles.username} weight="2">
          {username ? `@${username}` : "??? ?????? ????? ????"}
        </Text>
      </div>
    </header>
  );
}
