import { bootstrapApplication } from '@angular/platform-browser';
import { provideBrowserGlobalErrorListeners } from '@angular/core';
import { DtsAdminApp } from './dts-admin-app';
import { reloadOnNewBuild } from '../app/app-update';

/** The DTS management pages are their own application, behind the admin login: they share no pages with the signers' app, only libraries. */
bootstrapApplication(DtsAdminApp, { providers: [provideBrowserGlobalErrorListeners()] }).catch((err) => console.error(err));

// every page of this application sits behind the login, so its own index page is safe to poll
reloadOnNewBuild(undefined, document, window);

// The pages open without connection from the copy this worker keeps; a failure (private window, blocked) only means no offline shell.
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/dts-admin-sw.js', { scope: '/dts-admin/' }).catch(() => undefined);
