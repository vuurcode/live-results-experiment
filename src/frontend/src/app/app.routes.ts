import { Routes } from '@angular/router';
import { DashboardComponent } from './dashboard/dashboard.component';

// The dashboard is the landing page and ships with the main bundle; the other pages load when first visited.
export const routes: Routes = [
  { path: '', component: DashboardComponent },
  { path: 'ranking', loadComponent: () => import('./ranking/ranking.component').then((m) => m.RankingComponent) },
  { path: 'start-list', loadComponent: () => import('./start-list/start-list.component').then((m) => m.StartListComponent) },
  { path: 'logs', loadComponent: () => import('./logs/logs.component').then((m) => m.LogsComponent) },
  { path: 'settings', loadComponent: () => import('./settings/settings.component').then((m) => m.SettingsComponent) },
  { path: '**', redirectTo: '' }
];
