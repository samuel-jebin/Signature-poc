import { Routes } from '@angular/router';
import { DesktopComponent } from './desktop.component';
import { MobileSignComponent } from './mobile-sign.component';

export const routes: Routes = [
  { path: '', component: DesktopComponent },
  { path: 'sign/:id', component: MobileSignComponent },
  { path: '**', redirectTo: '' },
];
