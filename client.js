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
		const logo = 'data:image/svg+xml,' + encodeURIComponent("<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"currentColor\" fill-rule=\"evenodd\"><path d=\"M9.205 8.658v-2.26c0-.19.072-.333.238-.428l4.543-2.616c.619-.357 1.356-.523 2.117-.523 2.854 0 4.662 2.212 4.662 4.566 0 .167 0 .357-.024.547l-4.71-2.759a.8.8 0 0 0-.856 0zm10.609 8.8V12.06c0-.333-.143-.57-.429-.737l-5.97-3.473 1.95-1.118a.43.43 0 0 1 .476 0l4.543 2.617c1.309.76 2.189 2.378 2.189 3.948 0 1.808-1.07 3.473-2.76 4.163zM7.802 12.703l-1.95-1.142a.45.45 0 0 1-.239-.428V5.899c0-2.545 1.95-4.472 4.591-4.472 1 0 1.927.333 2.712.928L8.23 5.067c-.285.166-.428.404-.428.737zM12 15.128l-2.795-1.57v-3.33L12 8.658l2.795 1.57v3.33zm1.796 7.23c-1 0-1.927-.332-2.712-.927l4.686-2.712c.285-.166.428-.404.428-.737v-6.898l1.974 1.142c.167.095.238.238.238.428v5.233c0 2.545-1.974 4.472-4.614 4.472zm-5.637-5.303-4.544-2.617c-1.308-.761-2.188-2.378-2.188-3.948A4.48 4.48 0 0 1 4.21 6.327v5.423c0 .333.143.571.428.738l5.947 3.449-1.95 1.118a.43.43 0 0 1-.476 0m-.262 3.9c-2.688 0-4.662-2.021-4.662-4.519 0-.19.024-.38.047-.57l4.686 2.71a.79.79 0 0 0 .856 0l5.97-3.448v2.26c0 .19-.07.333-.237.428l-4.543 2.616c-.619.357-1.356.523-2.117.523m5.899 2.83a5.95 5.95 0 0 0 5.827-4.756C22.287 18.339 24 15.84 24 13.296c0-1.665-.713-3.282-1.998-4.448.119-.5.19-.999.19-1.498 0-3.401-2.759-5.947-5.946-5.947a5.7 5.7 0 0 0-1.88.31A5.96 5.96 0 0 0 10.205 0a5.95 5.95 0 0 0-5.827 4.757C1.713 5.447 0 7.945 0 10.49c0 1.666.713 3.283 1.998 4.448-.119.5-.19 1-.19 1.499 0 3.401 2.759 5.946 5.946 5.946.642 0 1.26-.095 1.88-.309a5.96 5.96 0 0 0 4.162 1.713z\"/></svg>");
		// DSH 0.2.0-rc.2: only Auto has the badge child in these picker elements.
		const autoTrigger = '.wXeviG_trigger:has(> .wXeviG_badge)';
		const autoOption = '.wXeviG_optionLabel:has(> .wXeviG_badge)';
		const pickerCss = `
${autoTrigger} > .wXeviG_badge, ${autoOption} > .wXeviG_badge { display: none; }
${autoTrigger}::before, ${autoOption}::before {
 content: ''; display: inline-block; flex: none; width: 14px; height: 14px;
 background: currentColor; mask: url("${logo}") center / contain no-repeat;
}
${autoOption} { align-items: center; gap: 8px; }
${autoOption}::before { width: 16px; height: 16px; }`;
		const copy = {
			en: {
				'auto.badge': '',
				'auto.description': 'Run without a sandbox after a fixed codex-auto-review review of every native tool call and PTC inner call.',
				'auto.confirm.description': 'Auto review runs without a sandbox. Before every native tool call and PTC inner call, the fixed codex-auto-review reviewer decides whether to allow it; you approve or reject each call it denies. This feature is experimental, can falsely allow or deny actions, and uses additional tokens.'
			},
			zh: {
				'auto.badge': '',
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
			ctx.effect(() => {
				if (typeof document === 'undefined') return;
				const style = document.createElement('style');
				style.setAttribute('data-plugin', 'dsh-auto-codex-review');
				style.textContent = pickerCss;
				document.head.appendChild(style);
				return () => style.remove();
			}, 'auto-codex-review: picker appearance');
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
