import { bootstrapApplication } from '@angular/platform-browser';
import { provideBrowserGlobalErrorListeners } from '@angular/core';
import { DtsApp } from './dts-app';
import { reloadOnNewBuild } from '../app/app-update';

/** The DTS sign-in pages are their own application: they share no code with the live results dashboard but the wake lock and update helpers. */
bootstrapApplication(DtsApp, { providers: [provideBrowserGlobalErrorListeners()] }).catch((err) => console.error(err));

reloadOnNewBuild();
