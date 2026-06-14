// File-based storage module — drop-in replacement for localforage
// Stores data as JSON files in ~/Documents/SURGdash/
// Uses electronAPI exposed by preload.js (contextIsolation: true)
// Writes use atomic write-then-rename to prevent corruption.

(function() {
    const fs   = electronAPI.fs;
    const path = electronAPI.path;
    const os   = electronAPI.os;

    const DATA_DIR = path.join(os.homedir(), 'Documents', 'SURGdash');

    // Key-to-filepath mapping for organised folder structure
    function keyToPath(key) {
        // Backup keys: strip 'backup_' prefix and nest under backup/
        if (key.startsWith('backup_')) {
            return path.join(DATA_DIR, 'backup', keyToRelative(key.slice(7)));
        }
        return path.join(DATA_DIR, keyToRelative(key));
    }

    function keyToRelative(key) {
        // Project-specific data: surgdash_{type}_{projectId}
        const projMatch = key.match(/^surgdash_(targets|actuals|events|updates|kpi|facilities|budget)_(.+)$/);
        if (projMatch) return path.join('projects', projMatch[2], projMatch[1] + '.json');

        // SURGhub data
        const surghubMap = {
            'surghub_data':         path.join('surghub', 'data.json'),
            'surghub_history':      path.join('surghub', 'history.json'),
            'surghub_ambassadors':  path.join('surghub', 'ambassadors.json'),
            'surghub_unique_users': path.join('surghub', 'unique_users.json'),
            'surghub_anon_users':   path.join('surghub', 'anon_users.json'),
            'surghub_user_courses': path.join('surghub', 'user_courses.json'),
            'surghub_user_certs':   path.join('surghub', 'user_certs.json'),
            'surghub_signup_demo':  path.join('surghub', 'signup_demo.json'),
            'surghub_signup_survey_url': path.join('surghub', 'signup_survey_url.json'),
            'surghub_email_demo':   path.join('surghub', 'email_demo.json'),
            'surghub_social':       path.join('surghub', 'social.json'),
            'surghub_completion':   path.join('surghub', 'completion.json'),
            'surghub_selected_testimonials': path.join('surghub', 'selected_testimonials.json'),
        };
        if (surghubMap[key]) return surghubMap[key];

        // Registry
        if (key === 'surgdash_projects') return 'projects.json';
        if (key === 'surgdash_pending_submissions') return path.join('pending', 'submissions.json');

        // Settings
        if (key === 'surgdash_last_project') return path.join('settings', 'last_project.json');
        if (key === 'surgdash_demo_active')  return path.join('settings', 'demo_active.json');
        if (key === 'surgdash_onboarding')      return path.join('settings', 'onboarding.json');
        if (key === 'surgdash_edit_password')  return path.join('settings', 'edit_password.json');
        if (key === 'report_cover_path')     return path.join('settings', 'report_cover_path.json');
        if (key === 'report_back_path')      return path.join('settings', 'report_back_path.json');
        if (key === 'report_period')         return path.join('settings', 'report_period.json');
        if (key === 'learnworlds_client_id')     return path.join('settings', 'learnworlds_client_id.json');
        if (key === 'learnworlds_api_token')     return path.join('settings', 'learnworlds_api_token.json');
        if (key === 'learnworlds_school_domain') return path.join('settings', 'learnworlds_school_domain.json');
        if (key === 'surgdash_provider_map')     return path.join('settings', 'provider_map.json');
        if (key === 'surgdash_course_links')     return path.join('settings', 'course_links.json');
        if (key === 'surghub_local_mtime')   return path.join('settings', 'surghub_local_mtime.json');
        if (key === 'surghub_unsynced_local') return path.join('settings', 'surghub_unsynced_local.json');
        if (key === 'surghub_last_synced')   return path.join('settings', 'surghub_last_synced.json');

        // Fallback for any unknown keys
        return path.join('other', key + '.json');
    }

    // Reverse mapping: given a file path relative to DATA_DIR, return the key
    function relativeToKey(rel) {
        // Normalise path separators
        rel = rel.replace(/\\/g, '/');

        // projects/{id}/{type}.json
        const projMatch = rel.match(/^projects\/(.+?)\/(.+)\.json$/);
        if (projMatch) return `surgdash_${projMatch[2]}_${projMatch[1]}`;

        // surghub/{name}.json
        const shMatch = rel.match(/^surghub\/(.+)\.json$/);
        if (shMatch) {
            const reverseMap = {
                'data': 'surghub_data', 'history': 'surghub_history', 'ambassadors': 'surghub_ambassadors',
                'unique_users': 'surghub_unique_users', 'anon_users': 'surghub_anon_users', 'email_demo': 'surghub_email_demo',
                'user_courses': 'surghub_user_courses', 'user_certs': 'surghub_user_certs',
                'signup_demo': 'surghub_signup_demo',
                'signup_survey_url': 'surghub_signup_survey_url',
                'social': 'surghub_social', 'completion': 'surghub_completion',
                'selected_testimonials': 'surghub_selected_testimonials'
            };
            return reverseMap[shMatch[1]] || null;
        }

        if (rel === 'projects.json') return 'surgdash_projects';

        // settings/{name}.json
        const settMatch = rel.match(/^settings\/(.+)\.json$/);
        if (settMatch) {
            const reverseMap = {
                'last_project': 'surgdash_last_project', 'demo_active': 'surgdash_demo_active',
                'onboarding': 'surgdash_onboarding',
                'edit_password': 'surgdash_edit_password',
                'report_cover_path': 'report_cover_path', 'report_back_path': 'report_back_path',
                'report_period': 'report_period',
                'learnworlds_client_id': 'learnworlds_client_id',
                'learnworlds_api_token': 'learnworlds_api_token',
                'learnworlds_school_domain': 'learnworlds_school_domain',
                'provider_map': 'surgdash_provider_map',
                'course_links': 'surgdash_course_links',
                'surghub_local_mtime': 'surghub_local_mtime',
                'surghub_unsynced_local': 'surghub_unsynced_local',
                'surghub_last_synced': 'surghub_last_synced'
            };
            return reverseMap[settMatch[1]] || null;
        }

        // other/{key}.json
        const otherMatch = rel.match(/^other\/(.+)\.json$/);
        if (otherMatch) return otherMatch[1];

        return null;
    }

    function ensureDir(filePath) {
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    }

    // ── Corruption logging ──────────────────────────────────────────────────
    function logCorruption(key, filePath, error) {
        try {
            const logPath = path.join(DATA_DIR, 'corruption.log');
            const entry = `[${new Date().toISOString()}] key="${key}" file="${filePath}" error="${error.message}"\n`;
            fs.appendFileSync(logPath, entry);
        } catch (_) { /* best-effort logging */ }
    }

    // ── Atomic write: write to .tmp then rename ─────────────────────────────
    function atomicWrite(filePath, data) {
        ensureDir(filePath);
        const tmpPath = filePath + '.tmp';
        try {
            fs.writeFileSync(tmpPath, data, 'utf8');
            fs.renameSync(tmpPath, filePath);
        } catch (renameErr) {
            // Fallback: direct write if rename fails (e.g. cross-device)
            try {
                fs.writeFileSync(filePath, data, 'utf8');
            } catch (writeErr) {
                // Clean up .tmp if it exists
                try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch (_) {}
                throw writeErr;
            }
            // Clean up .tmp if direct write succeeded
            try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch (_) {}
        }
    }

    // ── .tmp recovery: if target is missing/corrupt, check for .tmp ─────────
    function recoverFromTmp(filePath, key) {
        const tmpPath = filePath + '.tmp';
        if (!fs.existsSync(tmpPath)) return null;

        try {
            const raw = fs.readFileSync(tmpPath, 'utf8');
            const parsed = JSON.parse(raw);
            // .tmp is valid — promote it to the real file
            try { fs.renameSync(tmpPath, filePath); } catch (_) {}
            console.warn(`Storage: recovered "${key}" from .tmp file`);
            return parsed;
        } catch (e) {
            // .tmp is also corrupt — clean it up
            try { fs.unlinkSync(tmpPath); } catch (_) {}
            return null;
        }
    }

    // ---- Public API (mirrors localforage) ----

    window.Storage = {
        DATA_DIR,

        async getItem(key) {
            const filePath = keyToPath(key);
            try {
                // If target file doesn't exist, try .tmp recovery
                if (!fs.existsSync(filePath)) {
                    return recoverFromTmp(filePath, key);
                }
                const raw = fs.readFileSync(filePath, 'utf8');
                return JSON.parse(raw);
            } catch (e) {
                if (e instanceof SyntaxError) {
                    // Target file is corrupted — try .tmp as fallback
                    logCorruption(key, filePath, e);
                    console.error(`Storage.getItem("${key}"): corrupted JSON — attempting .tmp recovery`, e);
                    const recovered = recoverFromTmp(filePath, key);
                    if (recovered !== null) return recovered;
                } else {
                    console.error(`Storage.getItem("${key}") error:`, e);
                }
                return null;
            }
        },

        async setItem(key, value, options) {
            const filePath = keyToPath(key);
            try {
                atomicWrite(filePath, JSON.stringify(value, null, 2));
            } catch (e) {
                console.error(`Storage.setItem("${key}") error:`, e);
            }
            // Internal writes (sync/pull timestamps) must not flag the banner.
            const isInternal = options && options.internal;
            // Mark in-memory dirty flag → banner shows immediately so the user
            // knows they need to click Sync. Skip nav-state and internal writes.
            const NAV_KEYS = new Set([
                'surgdash_last_project', 'surgdash_onboarding', 'surgdash_demo_active',
                'report_cover_path', 'report_back_path'
            ]);
            if (!isInternal && !NAV_KEYS.has(key) && window.App && App.markDirty) {
                App.markDirty();
            }
            return value;
        },

        async removeItem(key) {
            const filePath = keyToPath(key);
            try {
                if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
                // Also clean up any lingering .tmp
                const tmpPath = filePath + '.tmp';
                if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
            } catch (e) {
                console.error(`Storage.removeItem("${key}") error:`, e);
            }
        },

        async keys() {
            const result = [];
            function walk(dir, prefix) {
                if (!fs.existsSync(dir)) return;
                const entries = fs.readdirSync(dir, { withFileTypes: true });
                for (const entry of entries) {
                    const rel = prefix ? prefix + '/' + entry.name : entry.name;
                    // entry.isDirectory is a boolean (flattened by preload)
                    if (entry.isDirectory) {
                        // Never index the backup or raw-capture trees. raw/ holds verbatim
                        // API responses (emails + referrer_id) and must NEVER reach an
                        // export / Sheets backup, so it is excluded at this single boundary.
                        if (rel === 'backup' || rel === 'surghub/raw') continue;
                        walk(path.join(dir, entry.name), rel);
                    } else if (entry.name.endsWith('.json')) {
                        // Skip backup directory and .tmp files
                        if (!rel.startsWith('backup/')) {
                            const key = relativeToKey(rel);
                            if (key) result.push(key);
                        }
                    }
                }
            }
            walk(DATA_DIR, '');
            return result;
        },

        async clear() {
            try {
                if (fs.existsSync(DATA_DIR)) {
                    fs.rmSync(DATA_DIR, { recursive: true, force: true });
                }
                fs.mkdirSync(DATA_DIR, { recursive: true });
            } catch (e) {
                console.error('Storage.clear() error:', e);
            }
        },

        // ---- Migration from localforage (IndexedDB) ----
        async migrateFromLocalforage() {
            // Check if we've already migrated
            const migrationFlag = path.join(DATA_DIR, '.migrated');
            if (fs.existsSync(migrationFlag)) return false;

            // Ensure data dir exists
            if (!fs.existsSync(DATA_DIR)) {
                fs.mkdirSync(DATA_DIR, { recursive: true });
            }

            // Check if localforage has any data to migrate
            if (typeof localforage === 'undefined') {
                fs.writeFileSync(migrationFlag, new Date().toISOString(), 'utf8');
                return false;
            }

            const lfKeys = await localforage.keys();
            if (!lfKeys || lfKeys.length === 0) {
                fs.writeFileSync(migrationFlag, new Date().toISOString(), 'utf8');
                return false;
            }

            console.log(`Migrating ${lfKeys.length} keys from IndexedDB to JSON files...`);
            let count = 0;
            for (const key of lfKeys) {
                try {
                    const value = await localforage.getItem(key);
                    if (value !== null && value !== undefined) {
                        await this.setItem(key, value);
                        count++;
                    }
                } catch (e) {
                    console.error(`Migration failed for key "${key}":`, e);
                }
            }

            fs.writeFileSync(migrationFlag, new Date().toISOString(), 'utf8');
            console.log(`Migration complete: ${count} keys moved to ${DATA_DIR}`);
            return true;
        }
    };
})();
