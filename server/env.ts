/**
 * Load settings from .env (in the folder the server is started from) before anything else
 * reads process.env. Variables already set in the environment win.
 */
import fs from 'node:fs';

if (fs.existsSync('.env')) process.loadEnvFile('.env');
