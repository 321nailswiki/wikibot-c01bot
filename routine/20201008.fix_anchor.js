﻿/*
node 20201008.fix_anchor.js use_language=en
node 20201008.fix_anchor.js use_language=zh
node 20201008.fix_anchor.js use_language=ja

2020/10/9 19:0:26	初版試營運
2020/11/17 6:48:13	仮運用を行って。ウィキペディア日本語版における試験運転。

# Listen to edits modifying section title in ARTICLE.
# Checking all pages linking to the ARTICLE.
# If there are links with old anchor, modify it to the newer one.
# If need, the bot will search revisions to find previous renamed section title.

TODO:
# The bot may notice in the talk page for lost anchors. Or {{R from incorrect name}}, [[Category:Pages containing links with bad anchors]]

因為有延遲，可檢查當前版本是否為最新版本。
忽略包含不合理元素的編輯，例如 url。

檢核頁面移動的情況。
檢核/去除重複或無效的 anchor。

 */

'use strict';

// Load CeJS library and modules.
require('../wiki loader.js');

// Load modules.
CeL.run([
	// for CeL.assert()
	'application.debug.log']);

// Set default language. 改變預設之語言。 e.g., 'zh'
//set_language('zh');
/** {Object}wiki operator 操作子. */
const wiki = new Wikiapi;


// ----------------------------------------------


// ----------------------------------------------------------------------------

(async () => {
	await wiki.login(login_options);
	// await wiki.login(null, null, use_language);
	await main_process();
})();

async function main_process() {

	if (false) {
		// for debug only
		const revision = await wiki.tracking_revisions('安定门 (北京)', '拆除安定门前');
		console.trace(revision);
		return;

		await check_page('臺灣話', { force_check: true });

		await check_page('民族布尔什维克主义', { force_check: true });
		// [[w:zh:Special:Diff/37559912]]
		await check_page('香港特別行政區區旗', { force_check: true });
		await check_page('新黨', { force_check: true });

		await check_page('Species', { force_check: true });
		return;
	}

	wiki.latest_task_configuration.Section_link_alias
		= (await wiki.redirects_here('Template:Section link'))
			.map(page_data => page_data.title
				// remove "Template:" prefix
				.replace(/^[^:]+:/, ''));

	wiki.listen(for_each_row, {
		// 檢查的延遲時間。
		delay: '2m',
		//start: '30D',
		filter: filter_row,
		// also get diff
		with_diff: { LCS: true, line: true },
		// Only check edits in these namespaces. 只檢查這些命名空間中壞掉的文章章節標題。
		namespace: 0,
		parameters: {
			// 跳過機器人所做的編輯。
			// You need the "patrol" or "patrolmarks" right to request the
			// patrolled flag.
			// rcshow : '!bot',
			rcprop: 'title|ids|sizes|flags|user'
		},
		interval: '5s',
	});

	routine_task_done('1d');

	CeL.log('Listening...\n' + '-'.repeat(60));
}

function filter_row(row) {
	//console.trace(row);

	// There are too many vandalism by IP users...
	// [[w:en:User talk:Kanashimi#Bot is now erroneously changing links and anchors]]
	if (CeL.wiki.parse.user.is_IP(row.user)) {
		return;
	}

	// [[Wikipedia:優良條目評選/提名區]]
	// [[Wikipedia:優良條目重審/提名區]]
	// [[Wikipedia:優良條目候選/提名區]]
	// [[Wikipedia:典范条目评选/提名区]]
	// [[User:Cewbot/log/20150916]]
	if (/提名區|提名区|\/log\//.test(row.title)
		// [[Wikipedia:新条目推荐/候选]]
		|| /(\/Sandbox|\/沙盒|\/候选)$/.test(row.title)) {
		return;
	}

	//console.log([wiki.is_namespace(row, 'Draft'), wiki.is_namespace(row, 'User talk')]);
	if (wiki.is_namespace(row, 'Draft') || wiki.is_namespace(row, 'User talk')) {
		// ignore all link to [[Draft:]], [[User talk:]]
		return;
	}

	//CeL.info(`${filter_row.name}: ${row.title}`);
	return true;
}

async function for_each_row(row) {
	//CeL.info(`${for_each_row.name}: ${CeL.wiki.title_link_of(row.title)}`);
	const diff_list = row.diff;
	const removed_section_titles = [], added_section_titles = [];
	diff_list.forEach(diff => {
		//const [removed_text, added_text] = diff;
		// all_converted: 避免遺漏。 e.g., [[w:en:Special:Diff/812844088]]
		removed_section_titles.append(get_all_plain_text_section_titles_of_wikitext(diff[0]));
		added_section_titles.append(get_all_plain_text_section_titles_of_wikitext(diff[1]));
	});

	if (removed_section_titles.length > 3) {
		if (wiki.is_namespace(row, 'User talk') || wiki.is_namespace(row, 'Wikipedia talk')) {
			// 去除剪貼移動式 archive 的情況。
			CeL.info(`${for_each_row.name}: It seems ${CeL.wiki.title_link_of(row.title + '#' + removed_section_titles[0])} is just archived?`);
			return;
		}
		// TODO: check {{Archives}}, {{Archive box}}, {{Easy Archive}}
	}

	if (removed_section_titles.length > 0) {
		CeL.info(`${for_each_row.name}: ${CeL.wiki.title_link_of(row.title + '#' + removed_section_titles[0])
			}${removed_section_titles.length > 1 ? ` and other ${removed_section_titles.length - 1} section title(s) (#${removed_section_titles.slice(1).join(', #')})` : ''
			} is ${removed_section_titles.length === 1 && added_section_titles.length === 1 ? `renamed to ${JSON.stringify('#' + added_section_titles[0])} ` : 'removed'
			} by ${CeL.wiki.title_link_of('user:' + row.revisions[0].user)} at ${row.revisions[0].timestamp}.`);

		try {
			//console.trace(row.revisions[0].slots);
			const pages_modified = await check_page(row, { removed_section_titles, added_section_titles });
			// pages_modified maybe undefined
			CeL.info(`${for_each_row.name}: ${CeL.wiki.title_link_of(row.title)}: ${pages_modified > 0 ? pages_modified : 'No'} page(s) modified.`);
			if (pages_modified > 0) {
				CeL.error(`${for_each_row.name}: Modify ${pages_modified} page(s) link ${CeL.wiki.title_link_of(row.title)}`);
			}
		} catch (e) {
			console.error(e);
		}
		CeL.log('-'.repeat(60));
	}
}

// ----------------------------------------------------------------------------

function get_all_plain_text_section_titles_of_wikitext(wikitext) {
	const section_title_list = [];

	if (!wikitext) {
		return section_title_list;
	}

	const parsed = CeL.wiki.parser(wikitext).parse();
	parsed.each('section_title', section_title_token => {
		//console.log(section_title_token);
		const link = section_title_token.link;
		if (!link.imprecise_tokens) {
			// `section_title_token.title` will not transfer "[", "]"
			section_title_list.push(link[1]);

		} else if (link.tokens_maybe_handlable) {
			// exclude "=={{T}}=="
			CeL.warn(`Title maybe handlable 請檢查是否可處理此標題: ${section_title_token.title}`);
			console.log(link.tokens_maybe_handlable);
			console.trace(section_title_token);
		}
	});

	// 處理 {{Anchor|anchor}}
	parsed.each('template', template_token => {
		if (template_token.name !== 'Anchor')
			return;

		for (let index = 1; index < template_token.length; index++) {
			const anchor = template_token.parameters[index];
			if (anchor)
				section_title_list.push(anchor.toString().replace(/_/g, ' '));
		}
	});

	// 處理 <span class="anchor" id="anchor"></span>
	parsed.each('tag', tag_token => {
		const anchor = tag_token.attributes.id;
		if (anchor)
			section_title_list.push(anchor.replace(/_/g, ' '));
	});

	return section_title_list.unique();
}

const KEY_latest_page_data = Symbol('latest page_data');
const KEY_got_full_revisions = Symbol('got full revisions');
const KEY_lower_cased_section_titles = Symbol('lower cased section titles');
const MARK_case_change = 'case change';

function reduce_section_title(section_title) {
	return section_title.replace(/[\s_\-–()]/g, '').toLowerCase();
}

function get_section_title_data(section_title_history, section_title) {
	if (section_title in section_title_history)
		return section_title_history[section_title];

	// get possible section name variants: lowcased
	const reduced_section = reduce_section_title(section_title), original_section_title = section_title_history[KEY_lower_cased_section_titles][reduced_section];
	if (original_section_title) {
		return {
			title: reduced_section,
			rename_to: section_title_history[original_section_title].rename_to || original_section_title,
			variant_of: [[MARK_case_change, original_section_title]],
		};
	}

	// TODO: get possible section name variants: 以文字相似程度猜測
}

function set_section_title(section_title_history, section_title, data) {
	section_title_history[section_title] = data;

	const reduced_section = reduce_section_title(section_title);
	if (reduced_section !== section_title && !(reduced_section in section_title_history)) {
		//assert: (section_title in section_title_history)
		if (!(reduced_section in section_title_history[KEY_lower_cased_section_titles]) || data.is_present)
			section_title_history[KEY_lower_cased_section_titles][reduced_section] = section_title;
	}

	return data;
}

// 偵測繁簡轉換 字詞轉換 section_title
function mark_language_variants(recent_section_title_list, section_title_history, revision) {
	function mark_list(converted_list) {
		const language_variant = this;
		//console.trace(variant + ': ' + converted_list);
		recent_section_title_list.forEach((section_title, index) => {
			const converted = converted_list[index];
			if (section_title === converted)
				return;
			let record = section_title_history[converted];
			if (!record) {
				record = set_section_title(section_title_history, converted, {
					title: converted,
				});
			}
			if (!record.is_present) {
				if (record.rename_to && record.rename_to !== section_title) {
					CeL.error(`${mark_language_variants.name}: rename_to: ${record.rename_to}→${section_title}`);
				}
				record.rename_to = section_title;
			}
			CeL.debug(`${mark_language_variants.name}: ${converted}→${section_title}`);
			if (!record.variant_of)
				record.variant_of = [];
			record.variant_of.push([language_variant, section_title]);
		});
		//console.log(section_title_history);
	}

	for (const language_variant of ['zh-hant', 'zh-hans']) {
		//await
		wiki.convert_Chinese(recent_section_title_list, language_variant).then(mark_list.bind(language_variant));
	}
}

// get section title history
async function tracking_section_title_history(page_data, options) {
	options = CeL.setup_options(options);
	//section_title_history[section_title]={appear:{revid:0},disappear:{revid:0},rename_to:''}
	const section_title_history = options.section_title_history || {
		// 所有頁面必然皆有的 default anchors
		top: {
			is_present: true
		},
		[KEY_lower_cased_section_titles]: Object.create(null),
	};

	function set_recent_section_title(wikitext, revision) {
		const section_title_list = get_all_plain_text_section_titles_of_wikitext(wikitext);
		mark_language_variants(section_title_list, section_title_history, revision);
		section_title_list.forEach(section_title =>
			set_section_title(section_title_history, section_title, {
				title: section_title,
				// is present section title
				is_present: revision || true,
				appear: null,
			})
		);
		section_title_history[KEY_latest_page_data] = page_data;
	}

	if (options.set_recent_section_only) {
		page_data = await wiki.page(page_data);
		set_recent_section_title(page_data.wikitext);
		return section_title_history;
	}

	function check_and_set(section_title, type, revision) {
		if (!section_title_history[section_title]) {
			section_title_history[section_title] = {
				title: section_title,
				appear: null,
			};
		} else if (section_title_history[section_title][type]) {
			// 已經有比較新的資料。
			if (CeL.is_debug()) {
				CeL.warn(`${tracking_section_title_history.name}: ${type} of ${wiki.normalize_title(page_data)}#${section_title} is existed! ${JSON.stringify(section_title_history[section_title])
					}`);
				CeL.log(`Older to set ${type}: ${JSON.stringify(revision)}`);
			}
			return true;
		}
		section_title_history[section_title][type] = revision;
	}

	function set_rename_to(from, to) {
		if (from === to || section_title_history[from]?.is_present)
			return;

		let very_different;
		const reduced_from = reduce_section_title(from), reduced_to = reduce_section_title(to);
		// only fixes similar section names (to prevent errors)
		// 當標題差異過大時，不視為相同的意涵。會當作缺失。
		if ((reduced_to.length < 2 || !reduced_from.includes(reduced_to)) && (reduced_from.length < 2 || !reduced_to.includes(reduced_from))
			// @see CeL.edit_distance()
			&& (very_different = 2 * CeL.LCS(from, to, 'diff').reduce((length, diff) => length + diff[0].length + diff[1].length, 0)) > from.length + to.length
		) {
			very_different += `>${from.length + to.length}`;
			CeL.error(`${set_rename_to.name}: Too different to be regarded as the same meaning (${very_different}): ${from}→${to}`);
		} else {
			very_different = false;
		}

		const rename_to_chain = [from], is_directly_rename_to = section_title_history[to]?.is_present;
		while (!section_title_history[to]?.is_present && section_title_history[to]?.rename_to) {
			rename_to_chain.push(to);
			to = section_title_history[to].rename_to;
			if (rename_to_chain.includes(to)) {
				rename_to_chain.push(to);
				CeL.warn(`${tracking_section_title_history.name}: Looped rename chain @ ${CeL.wiki.title_link_of(page_data)}: ${rename_to_chain.join('→')}`);
				return;
			}
		}

		if (!section_title_history[from]) {
			set_section_title(section_title_history, from, {
				title: from
			});
		}
		Object.assign(section_title_history[from], {
			is_directly_rename_to, very_different,
			// 警告: 需要自行檢查 section_title_history[to]?.is_present
			rename_to: to
		});
	}

	//if (section_title_history[KEY_got_full_revisions]) return section_title_history;

	CeL.info(`${tracking_section_title_history.name}: Trying to traversal all revisions of ${CeL.wiki.title_link_of(page_data)}...`);

	await wiki.tracking_revisions(page_data, (diff, revision) => {
		if (!section_title_history[KEY_latest_page_data]) {
			set_recent_section_title(CeL.wiki.revision_content(revision), revision);
		}

		let [removed_text, added_text] = diff;
		if (false)
			console.trace([diff, removed_text, added_text, revision]);

		removed_text = get_all_plain_text_section_titles_of_wikitext(removed_text);
		added_text = get_all_plain_text_section_titles_of_wikitext(added_text);

		if (removed_text.length === 0 && added_text.length === 0)
			return;

		if (!revision.removed_section_titles) {
			revision.removed_section_titles = [];
			revision.added_section_titles = [];
		}
		revision.removed_section_titles.append(removed_text);
		revision.added_section_titles.append(added_text);

	}, {
		revision_post_processor(revision) {
			// save memory
			delete revision.slots;
			delete revision.diff_list;

			if (!revision.removed_section_titles) {
				// No new section title modified
				return;
			}

			revision.removed_section_titles = revision.removed_section_titles.filter(section_title => {
				// 警告：在 line_mode，"A \n"→"A\n" 的情況下，
				// "A" 會同時出現在增加與刪除的項目中，此時必須自行檢測排除。
				// 亦可能是搬到較遠地方。
				const index = revision.added_section_titles.indexOf(section_title);
				if (index >= 0) {
					revision.added_section_titles.splice(index, 1);
				} else {
					return true;
				}
			});

			let has_newer_data;
			revision.removed_section_titles.forEach(section_title => {
				if (check_and_set(section_title, 'disappear', revision)) {
					has_newer_data = true;
				}
			});
			revision.added_section_titles.forEach(section_title => {
				if (check_and_set(section_title, 'appear', revision)) {
					//has_newer_data = true;
				}
			});

			// 檢查變更紀錄可以找出變更章節名稱的情況。一增一減時，才當作是改變章節名稱。
			// TODO: 整次編輯幅度不大，且一增一減時，才當作是改變章節名稱。
			if (!has_newer_data && revision.removed_section_titles.length === 1 && revision.added_section_titles.length === 1) {
				const from = revision.removed_section_titles[0], to = revision.added_section_titles[0];
				// assert: section_title_history[from].disappear === revision && section_title_history[to].appear === revision
				if (!section_title_history[from].rename_to) {
					// from → to
					set_rename_to(from, to);
				} else if (to !== section_title_history[from].rename_to) {
					// 這個時間點之後，`from` 有再次出現並且重新命名過。
					CeL.warn(`#${from} is renamed to #${section_title_history[from].rename_to} in newer revision, but also renamed to #${to} in older revision`);
					// TODO: ignore reverted edit
				}
			}

		},
		search_diff: true,
		rvlimit: 'max',
	});

	section_title_history[KEY_got_full_revisions] = true;
	return section_title_history;
}

async function check_page(target_page_data, options) {
	options = CeL.setup_options(options);
	const link_from = await wiki.redirects_here(target_page_data);
	//console.log(link_from);
	const target_page_redirects = Object.create(null);
	link_from
		.forEach(page_data => target_page_redirects[page_data.title] = true);
	// TODO: 字詞轉換 keys of target_page_redirects
	//console.log(Object.keys(target_page_redirects));

	target_page_data = link_from[0];
	if (target_page_data.convert_from)
		target_page_redirects[target_page_data.convert_from] = true;
	const section_title_history = await tracking_section_title_history(target_page_data, { set_recent_section_only: true });
	//console.trace(section_title_history);

	link_from.append((await wiki.backlinks(target_page_data, {
		// Only edit broken links in these namespaces. 只更改這些命名空間中壞掉的文章章節標題。
		namespace: wiki.site_name() === 'enwiki' ? 0 : 'main|file|module|template|category|help|portal'
	})).filter(page_data =>
		!/\/(Sandbox|沙盒|Archives?|存檔|存档)( ?\d+)?$/.test(page_data.title)
		// [[User:Cewbot/log/20151002/存檔5]]
		// [[MediaWiki talk:Spam-blacklist/存档/2017年3月9日]]
		// [[Wikipedia:頁面存廢討論/記錄/2020/08/04]]
		&& !/\/(Archives?|存檔|存档|記錄|log)\//.test(page_data.title)
		// [[Wikipedia:Articles for creation/Redirects and categories/2017-02]]
		// [[Wikipedia:Database reports/Broken section anchors/1]] will auto-updated by bots
		// [[Wikipedia:Articles for deletion/2014 Formula One season (2nd nomination)]]
		&& !/^(Wikipedia:(Articles for deletion|Articles for creation|Database reports))\//.test(page_data.title)
	));

	if (link_from.length > 800 && !options.force_check
		// 連結的頁面太多時，只挑選較確定是改變章節名稱的。
		&& !(options.removed_section_titles && options.removed_section_titles.length === 1 && options.added_section_titles.length === 1)) {
		CeL.warn(`${check_page.name}: Too many pages (${link_from.length}) linking to ${CeL.wiki.title_link_of(target_page_data)}. Skip this page.`);
		return;
	}

	CeL.info(`${check_page.name}: Checking ${link_from.length} page(s) linking to ${CeL.wiki.title_link_of(target_page_data)}...`);

	let working_queue;
	// [[w:zh:Wikipedia:格式手册/链接#章節]]
	let summary = wiki.language === 'zh' ? '修正失效的章節標題：'
		// [[w:ja:Help:セクション#セクションへのリンク]]
		: wiki.language === 'ja' ? 'セクションへのリンクを修復する：'
			// [[w:en:MOS:BROKENSECTIONLINKS]]
			: 'Fix broken anchor: ';
	//summary = summary + CeL.wiki.title_link_of(target_page_data);
	const for_each_page_options = {
		no_message: true, no_warning: true,
		summary: summary + CeL.wiki.title_link_of(target_page_data),
		bot: 1, minor: 1, nocreate: 1,
		// [badtags] The tag "test" is not allowed to be manually applied.
		//tags: wiki.site_name() === 'enwiki' ? 'bot trial' : '',
	};

	// ----------------------------------------------------

	async function add_note_for_broken_anchors(linking_page_data, anchor_token, record) {
		function add_note_for_broken_anchors(talk_page_data) {
			//console.trace(talk_page_data);
			/** {Array} parsed page content 頁面解析後的結構。 */
			const parsed = CeL.wiki.parser(talk_page_data).parse();

			let has_broken_anchors_template;
			parsed.each('template', template_token => {
				if (template_token.name !== 'Broken anchors')
					return;

				has_broken_anchors_template = true;
				const index = template_token.index_of['links'];
				if (!index) {
					template_token.push('links=' + text_to_add);
					return parsed.each.exit;
				}

				// remove unknown anchors
				parsed.each.call(template_token[index], 'list', list_token => {
					for (let index = 0; index < list_token.length; index++) {
						const first_taken = list_token[index][0];
						if (first_taken.type === 'tag' && first_taken.tag === 'nowiki' && !main_page_wikitext.includes(first_taken[1].toString())) {
							// remove item that is not in main article.
							list_token.splice(index--, 1);
							removed_anchors++;
						}
					}
				});

				const original_text = template_token[index].toString();
				if (original_text.includes(anchor_token)) {
					// have already noticed
					return parsed.each.exit;
				}

				template_token[index] = original_text + text_to_add;
			});

			if (has_broken_anchors_template) {
				return parsed.toString();
			}

			// 添加在首段或首個 section_title 前，最後一個 template 後。
			text_to_add = `{{Broken anchors|links=${text_to_add}}}\n`;
			parsed.each((token, index, parent) => {
				if (typeof token !== 'string' && token.type !== 'transclusion') {
					parent.splice(index, 0, text_to_add);
					return parsed.each.exit;
				}
			}, {
				max_depth: 1
			});
			return parsed.toString();
		}

		const main_page_wikitext = linking_page_data.wikitext;
		let removed_anchors = 0;
		const talk_page_title = wiki.to_talk_page(linking_page_data);
		anchor_token = anchor_token.toString();
		// text inside <nowiki> must extractly the same with the linking wikitext in the main article.
		let text_to_add = `\n* <nowiki>${anchor_token}</nowiki>${record ? ` <!-- ${JSON.stringify(record)} -->` : ''}`;
		CeL.error(`${add_note_for_broken_anchors.name}: Notify broken anchor ${CeL.wiki.title_link_of(talk_page_title)}`)
		await wiki.edit_page(talk_page_title, add_note_for_broken_anchors, {
			//Notification of broken anchor
			summary: 'Notify broken anchor ' + anchor_token + (removed_anchors > 0 ? `, remove ${removed_anchors} anchor(s)` : ''),
			bot: 1,
			minor: 1,
			nocreate: false
		});
	}

	// ----------------------------------------------------

	function check_token(token, linking_page_data) {
		const page_title = (
			// assert: {{Section link}}
			token.page_title
			// assert: token.type === 'link'
			|| token[0]).toString();
		if (!(wiki.normalize_title(page_title) in target_page_redirects) || !token.anchor
			|| section_title_history[token.anchor]?.is_present
		) {
			return;
		}

		if (!section_title_history[KEY_got_full_revisions]) {
			if (working_queue) {
				working_queue.list.push(linking_page_data);
			} else {
				CeL.info(`${check_page.name}: Finding anchor ${token} that is not present in the latest revision of ${CeL.wiki.title_link_of(linking_page_data)}.`);
				// 依照 CeL.wiki.prototype.work, CeL.wiki.prototype.next 的作業機制，在此設定 section_title_history 會在下一批 link_from 之前先執行；不會等所有 link_from 都執行過一次後才設定 section_title_history。
				working_queue = tracking_section_title_history(target_page_data, { section_title_history })
					.then(() => wiki.for_each_page(working_queue.list, resolve_linking_page, for_each_page_options))
					.then(() => CeL.info(`${CeL.wiki.title_link_of(linking_page_data)}: Get ${Object.keys(section_title_history).length} section title records from page revisions.`))
					// free
					.then(() => working_queue = null);
				working_queue.list = [linking_page_data];
			}
			return;
		}

		const record = get_section_title_data(section_title_history, token.anchor);
		let rename_to = record?.rename_to;
		if (rename_to && section_title_history[rename_to]?.is_present) {
			let type;
			record.variant_of?.some(variant => {
				if (variant[1] === rename_to) {
					if (variant[0] === MARK_case_change) {
						type = wiki.site_name() === 'zhwiki' ? '大小寫或空白錯誤的章節標題' : 'Wrong capitalization / spaced section title';
					} else {
						type = '繁簡不符匹配而失效的章節標題';
					}
					return true;
				}
			});
			const ARROW_SIGN = record?.is_directly_rename_to || type ? '→' : '⇝';
			const hash = '#' + rename_to;

			CeL.info(`${CeL.wiki.title_link_of(linking_page_data)}: ${token}${ARROW_SIGN}${hash} (${JSON.stringify(record)})`);
			CeL.error(`${type ? type + ' ' : ''}${CeL.wiki.title_link_of(linking_page_data)}: #${token.anchor}${ARROW_SIGN}${hash}`);
			this.summary = `${summary}${type || `[[Special:Diff/${record.disappear.revid}|${record.disappear.timestamp}]]${record?.very_different ? ` (${wiki.site_name() === 'zhwiki' ? '差異極大' : 'VERY DIFFERENT'} ${record.very_different})` : ''}`
				} ${token[1]}${ARROW_SIGN}${CeL.wiki.title_link_of(target_page_data.title + hash)}`;

			if (token.anchor_index)
				token[token.anchor_index] = rename_to;
			else
				token[1] = hash;
			//changed = true;
			return true;
		} else {
			CeL.warn(`${check_page.name}: Lost section ${token} @ ${CeL.wiki.title_link_of(linking_page_data)} (${token.anchor}: ${JSON.stringify(record)}${rename_to && section_title_history[rename_to] ? `, ${rename_to}: ${JSON.stringify(section_title_history[rename_to])}` : ''
				})`);
			if (wiki.site_name() === 'jawiki') {
				add_note_for_broken_anchors(linking_page_data, token, rename_to && section_title_history[rename_to]);
			}
		}
	}

	// ------------------------------------------

	const Section_link_alias = wiki.latest_task_configuration.Section_link_alias;

	let pages_modified = 0;
	function resolve_linking_page(linking_page_data) {
		/** {Array} parsed page content 頁面解析後的結構。 */
		const parsed = linking_page_data.parse();
		// console.log(parsed);
		CeL.assert([linking_page_data.wikitext, parsed.toString()], 'wikitext parser check for ' + CeL.wiki.title_link_of(linking_page_data));
		if (linking_page_data.ns !== 0 && linking_page_data.wikitext.length > /* 10_000_000 / 500 */ 500_000) {
			CeL.log(`${check_page.name}: Big page ${CeL.wiki.title_link_of(linking_page_data)}: ${CeL.to_KB(linking_page_data.wikitext.length)} chars`);
		}

		let changed;
		// handle [[link#anchor|display text]]
		parsed.each('link', token => {
			if (check_token.call(this, token, linking_page_data))
				changed = true;
		});
		// handle {{Section link}}
		parsed.each('template', (token, index, parent) => {
			if (!Section_link_alias.includes(token.name))
				return;
			if (token.parameters[1]) {
				const matched = token.parameters[1].toString().includes('#');
				if (matched) {
					token[token.index_of[1]] = token.parameters[1].toString().replace('#', '|');
					parent[index] = token = CeL.wiki.parse(token.toString());
				}
			}

			token.page_title = wiki.normalize_title(token.parameters[1].toString()) || linking_page_data.title;
			//console.trace(token);
			for (let index = 2; index < token.length; index++) {
				token.anchor_index = token.index_of[index];
				if (!token.anchor_index)
					continue;
				token.anchor = token.parameters[index].toString().replace(/_/g, ' ');
				if (check_token.call(this, token, linking_page_data))
					changed = true;
			}
		});

		if (!changed)
			return Wikiapi.skip_edit;

		pages_modified++;
		return parsed.toString();
	}

	await wiki.for_each_page(link_from, resolve_linking_page, for_each_page_options);
	await working_queue;

	return pages_modified;
}
