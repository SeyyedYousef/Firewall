import { useMemo } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { retrieveLaunchParams } from '@telegram-apps/sdk-react';
import { AppRoot } from '@telegram-apps/telegram-ui';

import { AppLayout } from '@/components/layout/AppLayout';
import { DashboardPage } from '@/pages/Dashboard/DashboardPage';
import { GroupDashboardPage } from '@/pages/GroupDashboard/GroupDashboardPage';
import { GroupAnalyticsPage } from '@/pages/GroupAnalytics/GroupAnalyticsPage';
import { GroupGeneralSettingsPage } from '@/pages/GroupSettings/GeneralSettingsPage';
import { GroupBanSettingsPage } from '@/pages/GroupSettings/GroupBanSettingsPage';
import { GroupCountLimitSettingsPage } from '@/pages/GroupSettings/GroupCountLimitSettingsPage';
import { GroupSilenceSettingsPage } from '@/pages/GroupSettings/GroupSilenceSettingsPage';
import { GroupMandatoryMembershipPage } from '@/pages/GroupSettings/GroupMandatoryMembershipPage';
import { GroupCustomTextsPage } from '@/pages/GroupSettings/GroupCustomTextsPage';
import { StarsPage } from '@/pages/Stars/StarsPage';
import { GiveawayDashboardPage } from '@/pages/Giveaways/GiveawayDashboardPage';
import { CreateGiveawayPage } from '@/pages/Giveaways/CreateGiveawayPage';
import { JoinGiveawayPage } from '@/pages/Giveaways/JoinGiveawayPage';
import { GiveawayHistoryPage } from '@/pages/Giveaways/GiveawayHistoryPage';
import { ProfilePage } from '@/pages/Profile/ProfilePage';
import { MissionsPage } from '@/pages/Missions/MissionsPage';
import { PromoSliderManagerPage } from '@/pages/PromoSlides/PromoSliderManagerPage';

export function App() {
  const lp = useMemo(() => {
    try {
      return retrieveLaunchParams(true);
    } catch (error) {
      console.warn('[app] failed to retrieve launch params, falling back to defaults', error);
      return null;
    }
  }, []);

  const platform = lp && ['macos', 'ios'].includes(lp.tgWebAppPlatform) ? 'ios' : 'base';

  return (
    <AppRoot
      appearance='dark'
      platform={platform}
    >
      <HashRouter>
        <Routes>
          <Route path='/' element={<AppLayout/>}>
            <Route index element={<Navigate to='groups' replace/>}/>
            <Route path='groups' element={<DashboardPage/>}/>
            <Route path='groups/:groupId' element={<GroupDashboardPage/>}/>
            <Route path='groups/:groupId/analytics' element={<GroupAnalyticsPage/>}/>
            <Route path='groups/:groupId/settings/general' element={<GroupGeneralSettingsPage/>}/>
            <Route path='groups/:groupId/settings/bans' element={<GroupBanSettingsPage/>}/>
            <Route path='groups/:groupId/settings/limits' element={<GroupCountLimitSettingsPage/>}/>
            <Route path='groups/:groupId/settings/mute' element={<GroupSilenceSettingsPage/>}/>
            <Route path='groups/:groupId/settings/mandatory' element={<GroupMandatoryMembershipPage/>}/>
            <Route path='groups/:groupId/settings/texts' element={<GroupCustomTextsPage/>}/>
            <Route path='stars' element={<StarsPage/>}/>
            <Route path='missions' element={<MissionsPage/>}/>
            <Route path='giveaway' element={<Navigate to='giveaway/active' replace/>}/>
            <Route path='giveaway/active' element={<GiveawayDashboardPage/>}/>
            <Route path='giveaway/create' element={<CreateGiveawayPage/>}/>
            <Route path='giveaway/history' element={<GiveawayHistoryPage/>}/>
            <Route path='giveaway/join/:giveawayId' element={<JoinGiveawayPage/>}/>
            <Route path='promo-slides/manage' element={<PromoSliderManagerPage/>}/>
            <Route path='profile' element={<ProfilePage/>}/>
          </Route>
          <Route path='*' element={<Navigate to='/groups' replace/>}/>
        </Routes>
      </HashRouter>
    </AppRoot>
  );
}


