/**
 * Web client companion for dsh-auto-codex-review.
 *
 * The permission picker's Auto entry and its enable dialog are drawn from copy
 * owned by the shipped client plugin: `dsh-client-ui-permission-presets`
 * hard-codes `option.value === "auto" ? t("auto.description") : ...` in the
 * `permission.access` locale namespace and ignores host-supplied preset copy.
 * `locale.register` refuses a second registration for a namespace and locale
 * that already exists, so a plugin cannot replace those entries through the
 * public API.
 *
 * This module therefore rewrites the two shipped strings in the live locale
 * dictionary, which still describes the built-in same-model reviewer as
 * "the same model as the current agent". The originals are restored when the
 * bundle unloads. Everything is guarded: if the locale service or its
 * dictionary is not shaped as expected, the shipped copy is left untouched.
 */
window.__ModuleLoader__.load({
	id: 'dsh-auto-codex-review',
	factory: () => {
		const NS = 'permission.access';
		const copy = {
			en: {
				'auto.description': 'Run without a sandbox after a fixed codex-auto-review review of every native tool call and PTC inner call.',
				'auto.confirm.description': 'Auto review runs without a sandbox. Before every native tool call and PTC inner call, the fixed codex-auto-review reviewer decides whether to allow it; you approve or reject each call it denies. This feature is experimental, can falsely allow or deny actions, and uses additional tokens.'
			},
			zh: {
				'auto.description': '无沙箱运行；每次原生工具调用和 PTC 内层调用前，均由固定的 codex-auto-review 进行实验性审查。',
				'auto.confirm.description': 'Auto review 不使用沙箱。每次原生工具调用和 PTC 内层调用前，均由固定的 codex-auto-review 审查者决定是否放行；审查拒绝的调用由你批准或拒绝。此功能仍属实验性，可能误放行或误拒绝，并会消耗额外 token。'
			}
		};
		/** Rewrite the shipped Auto copy; returns a restore function or undefined when unavailable. */
		function override(locale) {
			const dicts = locale === void 0 || locale === null ? void 0 : locale.dicts;
			if (typeof Map !== 'function' || !(dicts instanceof Map)) return void 0;
			const locales = dicts.get(NS);
			if (locales === void 0 || typeof locales.get !== 'function') return void 0;
			const restore = [];
			for (const [id, entries] of Object.entries(copy)) {
				const dictionary = locales.get(id);
				if (dictionary === void 0 || typeof dictionary !== 'object' || dictionary === null) continue;
				for (const [key, text] of Object.entries(entries)) {
					if (typeof dictionary[key] !== 'string') continue;
					const original = dictionary[key];
					dictionary[key] = text;
					restore.push(() => {
						dictionary[key] = original;
					});
				}
			}
			return restore.length === 0 ? void 0 : () => {
				for (const undo of restore) undo();
			};
		}
		function apply(ctx) {
			const locale = typeof ctx.get === 'function' ? ctx.get('locale') : ctx.locale;
			ctx.effect(() => {
				const restore = override(locale);
				return () => restore?.();
			}, 'auto-codex-review: reviewer copy');
		}
		return {
			apply,
			inject: ['locale']
		};
	}
});
