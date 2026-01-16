import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { mdsvex } from 'mdsvex';

/** @type {import('mdsvex').MdsvexOptions} */
const mdsvexOptions = {
    extensions: ['.mdx'],
};

/** @type {import('@sveltejs/kit').Config} */
const config = {
    extensions: ['.svelte', ...mdsvexOptions.extensions],
    preprocess: [vitePreprocess({ script: true }), mdsvex(mdsvexOptions)],
    kit: {
        adapter: adapter({
            pages: 'build',
            assets: 'build',
            precompress: false,
            strict: true,
            fallback: '200.html', // SPA fallback for dynamic routes like /share/[token]
        }),
        paths: {
            base: process.argv.includes('dev') ? '' : process.env.BASE_PATH,
            relative: false,
        },
        prerender: {
            crawl: true,
            handleHttpError: ({ path, message }) => {
                // Ignore manifest errors when using base path
                if (path.includes('.webmanifest') || path.includes('manifest')) {
                    console.warn(`Ignoring prerender error for ${path}: ${message}`);
                    return;
                }
                throw new Error(message);
            },
        },
    },
};

export default config;
