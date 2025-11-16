import type { ComponentType } from "react";

import { DashboardPage } from "@/pages/Dashboard/DashboardPage";
import { GroupDashboardPage } from "@/pages/GroupDashboard/GroupDashboardPage";
import { GroupAnalyticsPage } from "@/pages/GroupAnalytics/GroupAnalyticsPage";
import { StarsPage } from "@/pages/Stars/StarsPage";
import { PromoSliderManagerPage } from "@/pages/PromoSlides/PromoSliderManagerPage";
import { GiveawayDashboardPage } from "@/pages/Giveaways/GiveawayDashboardPage";
import { CreateGiveawayPage } from "@/pages/Giveaways/CreateGiveawayPage";
import { JoinGiveawayPage } from "@/pages/Giveaways/JoinGiveawayPage";
import { GroupGeneralSettingsPage } from "@/pages/GroupSettings/GeneralSettingsPage";
import { GroupBanSettingsPage } from "@/pages/GroupSettings/GroupBanSettingsPage";
import { GroupSilenceSettingsPage } from "@/pages/GroupSettings/GroupSilenceSettingsPage";
import { GroupCountLimitSettingsPage } from "@/pages/GroupSettings/GroupCountLimitSettingsPage";
import { GroupMandatoryMembershipPage } from "@/pages/GroupSettings/GroupMandatoryMembershipPage";
import { GroupCustomTextsPage } from "@/pages/GroupSettings/GroupCustomTextsPage";

interface Route {
  path: string;
  Component: ComponentType;
  title?: string;
}

export const routes: Route[] = [
  { path: "/", Component: DashboardPage },
  { path: "/groups/:groupId", Component: GroupDashboardPage },
  { path: "/stars", Component: StarsPage },
  { path: "/promo-slides/manage", Component: PromoSliderManagerPage },
  { path: "/giveaways", Component: GiveawayDashboardPage },
  { path: "/giveaways/create", Component: CreateGiveawayPage },
  { path: "/giveaways/:giveawayId", Component: JoinGiveawayPage },
  { path: "/groups/:groupId/analytics", Component: GroupAnalyticsPage },
  { path: "/groups/:groupId/settings/general", Component: GroupGeneralSettingsPage },
  { path: "/groups/:groupId/settings/bans", Component: GroupBanSettingsPage },
  { path: "/groups/:groupId/settings/limits", Component: GroupCountLimitSettingsPage },
  { path: "/groups/:groupId/settings/mute", Component: GroupSilenceSettingsPage },
  { path: "/groups/:groupId/settings/mandatory", Component: GroupMandatoryMembershipPage },
  { path: "/groups/:groupId/settings/texts", Component: GroupCustomTextsPage },
];





