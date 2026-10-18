import { Routes } from '@angular/router';
import { DashboardComponent } from './dashboard/dashboard.component';
import { StartListComponent } from './start-list/start-list.component';
import { RankingComponent } from './ranking/ranking.component';

export const routes: Routes = [
  { path: '', component: DashboardComponent },
  { path: 'ranking', component: RankingComponent },
  { path: 'start-list', component: StartListComponent },
  { path: '**', redirectTo: '' }
];
