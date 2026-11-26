import { api } from './api.js';

export const store = {
    settings: null,
    bootstrap: null,
    overview: null,
    voices: [],
};

export async function refreshStore() {
    const [bootstrap, overview] = await Promise.all([
        api.get('/api/bootstrap'),
        api.get('/api/stats/overview'),
    ]);
    store.bootstrap = bootstrap;
    store.settings = bootstrap.settings;
    store.overview = overview;
    return store;
}

export async function refreshSettings() {
    store.settings = await api.get('/api/settings');
    if (store.bootstrap) store.bootstrap.settings = store.settings;
    return store.settings;
}

export async function saveSettings(patch) {
    store.settings = await api.patch('/api/settings', patch);
    if (store.bootstrap) store.bootstrap.settings = store.settings;
    return store.settings;
}

export function lang() {
    return store.settings?.lang === 'en' ? 'en' : 'zh';
}
