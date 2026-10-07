/**
 * Web client companion for dsh-auto-codex-review.
 *
 * The permission picker's Auto entry and its enable dialog are drawn from copy
 * owned by the shipped client plugin: `dsh-client-ui-permission-presets`
 * resolves `option.value === "auto"` to `t("auto.description")` and
 * `t("auto.confirm.description")` in the `permission.access` locale namespace
 * and ignores host-supplied preset copy. `locale.register` refuses a second
 * registration for a namespace and locale that already exists, so a plugin
 * cannot replace those entries through the public API.
 *
 * This module therefore rewrites the two shipped strings in the live locale
 * dictionary. That dictionary may not exist yet when this plugin activates, and
 * the locale service notifies subscribers on every registration, so the rewrite
 * is retried on each locale revision until it lands. Originals are restored when
 * the bundle unloads. Every step is guarded: when the locale service, its
 * dictionary, or the shipped strings are not shaped as expected, the shipped
 * copy is left untouched.
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
		/** Rewrite the shipped Auto copy; returns a restore function, or undefined while the dictionary is absent. */
		function patch(locale) {
			const dicts = locale === void 0 || locale === null ? void 0 : locale.dicts;
			if (typeof Map !== 'function' || !(dicts instanceof Map)) return void 0;
			const locales = dicts.get(NS);
			if (locales === void 0 || typeof locales.get !== 'function') return void 0;
			const undo = [];
			for (const [id, entries] of Object.entries(copy)) {
				const dictionary = locales.get(id);
				if (dictionary === void 0 || typeof dictionary !== 'object' || dictionary === null) continue;
				for (const [key, text] of Object.entries(entries)) {
					if (typeof dictionary[key] !== 'string' || dictionary[key] === text) continue;
					const original = dictionary[key];
					dictionary[key] = text;
					undo.push(() => {
						dictionary[key] = original;
					});
				}
			}
			return undo.length === 0 ? void 0 : () => {
				for (const revert of undo) revert();
			};
		}
		function apply(ctx) {
			const locale = (typeof ctx.get === 'function' ? ctx.get('locale') : void 0) ?? ctx.locale;
			ctx.effect(() => {
				let restore;
				let timer;
				const stopTimer = () => {
					if (timer !== void 0) {
						clearTimeout(timer);
						timer = void 0;
					}
				};
				const attempt = () => {
					if (restore !== void 0) return stopTimer();
					restore = patch(locale);
					if (restore !== void 0) stopTimer();
				};
				attempt();
				const off = typeof locale?.subscribe === 'function' ? locale.subscribe(attempt) : void 0;
				/* Second net: a bounded poll in case the dictionary registers without notifying this subscriber. */
				if (restore === void 0 && typeof setTimeout === 'function') {
					let tries = 20;
					const tick = () => {
						timer = void 0;
						attempt();
						if (restore === void 0 && --tries > 0) timer = setTimeout(tick, 500);
					};
					timer = setTimeout(tick, 500);
				}
				return () => {
					off?.();
					stopTimer();
					restore?.();
				};
			}, 'auto-codex-review: reviewer copy');
		}
		return {
			apply,
			inject: ['locale']
		};
	}
});
