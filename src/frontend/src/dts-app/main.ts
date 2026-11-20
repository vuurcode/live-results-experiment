import { bootstrapApplication } from '@angular/platform-browser';
import { provideBrowserGlobalErrorListeners } from '@angular/core';
import { DtsApp } from './dts-app';
import { reloadOnNewBuild } from '../app/app-update';

/** The DTS sign-in pages are their own application: they share no code with the live results dashboard but the wake lock and update helpers. */
bootstrapApplication(DtsApp, { providers: [provideBrowserGlobalErrorListeners()] }).catch((err) => console.error(err));

// /dts/ itself asks for the admin login; the same page without it is /dts/index.html
reloadOnNewBuild(undefined, document, window, '/dts/index.html');
