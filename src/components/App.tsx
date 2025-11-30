import { lazy, Suspense, useMemo } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { retrieveLaunchParams } from '@telegram-apps/sdk-react';
import { AppRoot } from '@telegram-apps/telegram-ui';

import { AppLayout } from '@/components/layout/AppLayout';
import { LoadingState } from '@/components/LoadingState';

// Lazy load pages for better performance
const DashboardPage = lazy(() => import('@/pages/Dashboard/DashboardPage').then(m => ({ default: m.DashboardPage })));
const GroupDashboardPage = lazy(() => import('@/pages/GroupDashboard/GroupDashboardPage').then(m => ({ default: m.GroupDashboardPage })));
const GroupAnalyticsPage = lazy(() => import('@/pages/GroupAnalytics/GroupAnalyticsPage').then(m => ({ default: m.GroupAnalyticsPage })));
const GroupGeneralSettingsPage = lazy(() => import('@/pages/GroupSettings/GeneralSettingsPage').then(m => ({ default: m.GroupGeneralSettingsPage })));
const GroupBanSettingsPage = lazy(() => import('@/pages/GroupSettings/GroupBanSettingsPage').then(m => ({ default: m.GroupBanSettingsPage })));
const GroupCountLimitSettingsPage = lazy(() => import('@/pages/GroupSettings/GroupCountLimitSettingsPage').then(m => ({ default: m.GroupCountLimitSettingsPage })));
const GroupSilenceSettingsPage = lazy(() => import('@/pages/GroupSettings/GroupSilenceSettingsPage').then(m => ({ default: m.GroupSilenceSettingsPage })));
const GroupMandatoryMembershipPage = lazy(() => import('@/pages/GroupSettings/GroupMandatoryMembershipPage').then(m => ({ default: m.GroupMandatoryMembershipPage })));
const GroupCustomTextsPage = lazy(() => import('@/pages/GroupSettings/GroupCustomTextsPage').then(m => ({ default: m.GroupCustomTextsPage })));
const StarsPage = lazy(() => import('@/pages/Stars/StarsPage').then(m => ({ default: m.StarsPage })));
const GiveawayDashboardPage = lazy(() => import('@/pages/Giveaways/GiveawayDashboardPage').then(m => ({ default: m.GiveawayDashboardPage })));
const CreateGiveawayPage = lazy(() => import('@/pages/Giveaways/CreateGiveawayPage').then(m => ({ default: m.CreateGiveawayPage })));
const JoinGiveawayPage = lazy(() => import('@/pages/Giveaways/JoinGiveawayPage').then(m => ({ default: m.JoinGiveawayPage })));
const GiveawayHistoryPage = lazy(() => import('@/pages/Giveaways/GiveawayHistoryPage').then(m => ({ default: m.GiveawayHistoryPage })));
const ProfilePage = lazy(() => import('@/pages/Profile/ProfilePage').then(m => ({ default: m.ProfilePage })));
const MissionsPage = lazy(() => import('@/pages/Missions/MissionsPage').then(m => ({ default: m.MissionsPage })));
const PromoSliderManagerPage = lazy(() => import('@/pages/PromoSlides/PromoSliderManagerPage').then(m => ({ default: m.PromoSliderManagerPage })));

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
        <Suspense fallback={<LoadingState />}>
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
        </Suspense>
      </HashRouter>
    </AppRoot>
  );
}


