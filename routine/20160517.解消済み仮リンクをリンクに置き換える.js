﻿// (cd ~/wikibot && date && hostname && nohup time node 20160517.解消済み仮リンクをリンクに置き換える.js use_language=zh; date) >> 解消済み仮リンクをリンクに置き換える/log &

/*

 [[:ja:Wikipedia:井戸端/subj/解消済み仮リンクを自動的に削除して]]
 [[:ja:Wikipedia:井戸端/subj/仮リンクの解消の作業手順について]]
 2016/5/20 22:22:41	仮運用を行って。ウィキペディア日本語版における試験運転。

 Workflow 工作流程:
 # 自維基百科 message_set.Category_has_local_page 取得所有包含本地連結的頁面標題文字/條目名稱。
 # 以函數 for_each_page() + for_each_template() 檢查每一個頁面，找出所有跨語言模板。
 # 以函數 for_foreign_page() 檢查跨語言模板模板所指引的外語言條目連結是否合適。
 # 以函數 for_local_page() 檢查外語言條目連結所指向的本地條目連結是否合適。
 # 以函數 check_local_creation_date() 檢查本地頁面是否創建夠久(7天)，跳過一禮拜內新建（或有更新）頁面，有刪除模板的亦跳過之。
 # 以函數 exclude_talk_page() 排除使用者發言。
 # 對於通過測試的跨語言模板連結，以函數 modify_link() 修改跨語言模板。
 # 以函數 check_page() 收尾每一個頁面的工作。
 # 以函數 check_final_work()寫入報告。

 清理跨語言連結：將已存在本地條目之跨語言連結模板（包含{{tl|illm}}以及其他）轉為一般 wikilink。
 本任務已在jawiki與enwiki穩定定期運行過一段時間。特點為能夠產生結果報告，幫助編輯者快速找出問題所在。

 @see
 https://github.com/liangent/mediawiki-maintenance/blob/master/cleanupILH_DOM.php

 TODO:
 如果來自{{Translation/Ref}}所引起的話，則請檢查<article>參數。
 {{main|{{跨語言連結}}}} → {{main|連結}}, NOT {{main|[[連結]]}} 要把連結也拿掉

 */

/*
 解消済み仮リンクをリンクに置き換える Convert interlanguage link templates with local article to wikilinks 將跨語言連結模板轉為內部連結（一般 wikilink）

 */

'use strict';

// Load CeJS library and modules.
require('../wiki loader.js');

// Set default language. 改變預設之語言。 e.g., 'zh'
// set_language('ja');
// set_language('en');

var
/** {Object}wiki operator 操作子. */
wiki = Wiki(true),

/** {revision_cacher}記錄處理過的文章。 */
processed_data = new CeL.wiki.revision_cacher(base_directory + 'processed.'
		+ use_language + '.json'),

// ((Infinity)) for do all
test_limit = 2,

ignore_ns = false,

/** {Natural}剩下尚未處理完畢的頁面數。 */
page_remains,

// default parameters 預設index/次序集
// c: foreign_language: foreign_language code 外文語言代號
// F: foreign_title: foreign_title 外文條目名
// L: local_title: local title 中文條目名
// label: label text displayed 顯示名
// preserve: preserve foreign language link
template_orders = {
	LcF_ja : {
		local_title : 1,
		foreign_language : 2,
		foreign_title : 3,
		label : 'label',
		preserve : [ 'preserve', 'display' ]
	},
	LcF_en : {
		local_title : 1,
		foreign_language : 2,
		// will fallback
		foreign_title : [ 3, 1 ],
		// {{{WD|{{{wd}}}}}}
		WD : [ 'WD', 'wd' ],
		label : 'lt',
		preserve : [ 'preserve', 'display' ]
	},
	cLFl_en : {
		foreign_language : [ 1, 'lang' ],
		local_title : [ 2, 'en' ],
		foreign_title : [ 3, 'lang_title', 2, 'en' ],
		label : [ 4, 'lt', 'display', 'en_text' ]
	},
	cFL : {
		foreign_language : 1,
		foreign_title : 2,
		local_title : [ 3, 2 ],
		label : 4
	},
	LF : {
		local_title : 1,
		foreign_title : [ 2, 1 ],
		label : [ 'd', 3 ],
		foreign_language : 'lang-code'
	},
	LW : {
		local_title : 1,
		WD : 2,
		label : 3
	}
},

gettext = CeL.gettext,

/** {Object}L10n messages. 符合當地語言的訊息內容。 */
message_set = {
	ja : {
		// [[Wikipedia:井戸端/subj/Template:仮リンクに関連する提案#4月10日（合意形成）]]

		// 不知為何，有時會有 Template 明明有解消済み仮リンク、頁面本身具[[Category:解消済み仮リンクを含むページ]]，
		// 卻沒被列於[[Category:解消済み仮リンクを含むページ]]。
		// Category_has_local_page : 'Category:解消済み仮リンクを含むページ',
		Category_has_local_page : [ 'Category:解消済み仮リンクを含む記事',
				'Category:解消済み仮リンクを含むページ' ],
		report_page : '修正が必要な仮リンク',
		fix_category : 'Category:修正が必要な仮リンクを含む記事',
		// 網羅所有 interlanguage link templates。
		// @see
		// https://ja.wikipedia.org/w/index.php?title=%E7%89%B9%E5%88%A5:%E3%83%AA%E3%83%B3%E3%82%AF%E5%85%83/Template:%E4%BB%AE%E3%83%AA%E3%83%B3%E3%82%AF&namespace=10&limit=500&hidetrans=1&hidelinks=1
		template_order_of_name : {
			// {{仮リンク|記事1|en|ABC|label|preserve=1}}
			仮リンク : template_orders.LcF_ja,
			// ={{仮リンク}}
			ill2 : template_orders.LcF_ja,
			// ={{仮リンク}}
			illm : template_orders.LcF_ja,
			// ={{仮リンク}}
			'link-interwiki' : template_orders.LcF_ja,

			日本語版にない記事リンク : template_orders.LcF_ja,

			'internal link helper' : template_orders.LF,
			// →{{Internal link helper/en}}
			'link-en' : Object.assign({
				'|foreign_language' : 'en'
			}, template_orders.LF)
		},

		// 仮リンクに記された「他言語版へのリンク先」が存在せず（赤リンク）、どの記事からもリンクされていないもの
		missing_foreign : '他言語版記事自体存在しません。',
		// 仮リンクに記された「他言語版へのリンク先」が曖昧さ回避であるもの
		foreign_is_disambiguation : '他言語版項目リンク先が曖昧さ回避ページです。',
		// [[ja:Help:セクション]]
		foreign_redirect_to_section : '他言語版項目リンク先がセクションへ転送します。',
		// リンク先が他言語版とリンクしていないもの
		missing_converted_local : '他言語版項目リンク先からの日本語版項目が存在しないか、他言語版とリンクしていません。',
		// リンク先の他言語版とのリンクが仮リンクに記されているものと違うもの
		// 仮リンクに記された「他言語版へのリンク先」とリンクしている「日本語版のページ名」が「第1引数のリンク先」と一致しないもの
		// TODO: Q6099744
		different_local_title : '日本語版項目名が違う記事です。',
		redirect_back_to_page_itself : '[[WP:SELF|自己言及]]リンク。',
		not_exist : '存在しません',
		from_parameter : '引数から',
		translated_from_foreign_title : '他言語版項目リンク先から',
		skip_talk_pages : '個人の発言が含まれているため修正しない',

		preserved : '強制表示引数(preserve)を指定するなので、修正の必要がありません。',
		retrive_foreign_error : '他言語版項目を取得できず、次回実行する時に再試行します。'
	},

	en : {
		Category_has_local_page : 'Category:Interlanguage link template existing link',
		report_page : 'Interlanguage link templates need to fix',
		fix_category : 'Category:Wikipedia backlog',
		// 2016‎/11 全部統合到 {{Interlanguage link}}
		template_order_of_name : {
			// When article names would be the same in English and foreign
			// language Wikipedia
			// @see [[:en:Template:Interlanguage link]]
			'interlanguage link' : template_orders.LcF_en,
			// ={{interlanguage link}}
			ill : template_orders.LcF_en,
			// ={{interlanguage link}}
			iii : template_orders.LcF_en,
			// ={{interlanguage link}}
			link : template_orders.LcF_en,
			// ={{interlanguage link}}
			'link-interwiki' : template_orders.LcF_en,

			'interlanguage link forced' : Object.assign({
				'|preserve' : 1
			}, template_orders.LcF_en),
			// ={{Interlanguage link forced}}
			ill2 : Object.assign({
				'|preserve' : 1
			}, template_orders.LcF_en),

			// https://en.wikipedia.org/w/index.php?title=Special%3AWhatLinksHere&hidetrans=1&hidelinks=1&target=Template%3Ainterlanguage+link+multi&namespace=
			'interlanguage link multi' : template_orders.LcF_en,
			// ={{interlanguage link multi}}
			illm : template_orders.LcF_en,

			// {{interlanguage link Wikidata}}
			'interlanguage link wikidata' : template_orders.LcF_en,
			// {{Ill-WD}} = {{interlanguage link Wikidata}}
			'ill-wd' : template_orders.LcF_en,

			'red wikidata link' : template_orders.LcF_en,
			// {{redwd|link target|Wikidata item ID|link title}}
			redwd : template_orders.LcF_en
		}
	},

	zh : {
		// Category:多語言連結已存在連結
		Category_has_local_page : 'Category:有蓝链却未移除内部链接助手模板的页面',
		report_page : '需要修正的跨語言連結',
		// fix_category : 'Category:跨語言連結有問題的頁面', Category:連結格式不正確的條目,
		// Category:维基百科积压工作, Category:需要清理的条目, Category:维基百科条目清理
		fix_category : 'Category:维基百科条目清理',
		// TODO: 這邊尚未列舉完成
		template_order_of_name : {
			'interlanguage link multi' : template_orders.LcF_en,
			// ={{interlanguage link multi}}
			illm : template_orders.LcF_en,

			tsl : template_orders.cFL,
			translink : template_orders.cFL,

			le : Object.assign({
				'|foreign_language' : 'en'
			}, template_orders.LF)
		},

		// 對應頁面, 指向的頁面
		missing_foreign : '所對應的外語條目不存在。',
		foreign_is_disambiguation : '所對應的外語頁面為消歧義頁。',
		foreign_redirect_to_section : '所對應的外語頁面重定向到了條目章節。',
		missing_converted_local : '外語條目沒有相對應的中文條目，或應該對應的中文條目並沒有連結到正確的Wikidata項目。',
		// 由於一些重定向不是常用的名稱，因此由機器人直接重定向可能不太妥當。這時仍需人工判別。
		different_local_title : '所對應的中文條目標題與模板參數所列出的不相符。',
		redirect_back_to_page_itself : '所對應的中文條目重定向到了頁面本身。[[WP:CIRCULAR]]或可擴充重定向？',
		local_title_too_new : '中文條目過新，將過幾天再測試。',
		not_exist : '不存在',
		from_parameter : '從模板參數',
		translated_from_foreign_title : '從外語頁面對應的中文條目',
		skip_talk_pages : '本作業不處理使用者發言',

		preserved : '指定了強制顯示參數，不做修改。',
		retrive_foreign_error : '無法取得所對應的外語條目。將於下次執行時再做嘗試。'
	},

	// default messages
	'*' : {
		report_notification :
		// gettext_config:{"id":"here-is-a-list-of-interlanguage-links-that-need-to-be-manually-corrected.-this-list-will-be-updated-automatically-by-the-robot"}
		gettext('Here is a list of interlanguage links that need to be manually corrected. This list will be updated automatically by the robot.'),
		// manually
		// 可能純粹為了註記關聯性（譯名）而存在，因此缺 foreign page。
		missing_foreign : 'Missing foreign page.',
		foreign_is_disambiguation : 'Foreign page is disambiguation.',
		foreign_redirect_to_section : 'Foreign page redirects to section.',
		missing_converted_local : 'Missing converted local page, or the foreign / local page is not link to wikidata.',
		// gets form langlinks
		different_local_title : 'The local title is different from title gets form wikidata.',
		redirect_back_to_page_itself : 'The local link target links back to the page itself. [[MOS:CIRCULAR]]?',
		local_title_too_new : 'The local page is too new. Will test later.',
		not_exist : 'Not exist',
		from_parameter : 'From the parameter of template',
		translated_from_foreign_title : 'Translated from foreign title',
		skip_talk_pages : 'This task does not process user talk',

		// always display
		preserved : 'Preserve interlanguage links for the "preserve" parameter is set.',
		retrive_foreign_error : 'Cannot retrive foreign page. I will retry next time.'
	}
};

// 將 message_set 轉成本地 local message set。
message_set = Object.assign(message_set['*'], message_set[use_language]);

if (use_language === 'zh') {
	'ar,az,be,bg,bs,ca,cs,da,de,el,en,eo,es,et,eu,fa,fi,fr,ga,he,hi,hr,hu,hy,id,is,it,ja,ka,kk,ko,ky,la,lo,lt,lv,mn,ms,my,nl,no,pl,pt,ro,ru,sh,sk,sl,so,sq,sr,sv,ta,te,tg,th,tl,tr,uk,ur,uz,vi,gan,lzh,nan,yue'
	// @see [[Template:Internal_link_helper]]
	.split(',').forEach(function(language_code) {
		var order = Object.assign({
			'|foreign_language' : language_code
		}, template_orders.LF);
		message_set.template_order_of_name
		// {{Internal link helper}}子模板
		['interlanguage link multi/' + language_code] = order;
		message_set.template_order_of_name
		//
		['link-' + language_code] = order;
		message_set.template_order_of_name
		//
		[language_code + '-link'] = order;
	});
}

function normalize_parameter(token) {
	var template_name = token.name.toLowerCase(),
	//
	index_order = message_set.template_order_of_name[template_name],
	// 實際使用的 index。
	index_order_exactly = Object.create(null);

	if (!index_order) {
		return;
	}

	var parameters = token.parameters,
	// normalized_parameters
	normalized = {
		index_order : index_order_exactly
	}, parameter_name;

	// 自 parameter 取得頁面標題文字/條目名稱。
	function set_title(index) {
		var parameter = parameters[index];
		if (parameter) {
			index_order_exactly[parameter_name] = token.index_of[index];
			// normalize
			parameter = parameter.toString()
			// 去除註解 comments。
			.replace(/<\!--[\s\S]*?-->/g, '').trim();
			try {
				parameter = decodeURIComponent(parameter).trim();
			} catch (e) {
				CeL.error('URI malformed: [' + parameter + ']');
			}
			normalized[parameter_name] = parameter;
			return true;
		}
	}

	for (parameter_name in index_order) {
		// {Number|String}index of
		var index = index_order[parameter_name];

		if (parameter_name.startsWith('|')) {
			// 非 index，而是直接指定值。
			normalized[parameter_name.slice(1)] = index;
			continue;
		}

		if (Array.isArray(index)) {
			index.some(set_title);

		} else {
			set_title(index);
		}
	}

	return normalized;
}

// ----------------------------------------------------------------------------

function check_final_work() {
	--page_remains;
	// CeL.debug('page_remains: ' + page_remains, 0, 'check_final_work');
	// console.trace('page_remains: ' + page_remains);

	if (page_remains > 0) {
		return;
	}

	// assert: page_remains === 0
	if (page_remains !== 0 || check_final_work.done) {
		throw page_remains;
	}
	check_final_work.done = true;

	wiki.page('User:' + wiki.token.login_user_name
	//
	+ '/' + message_set.report_page, {
		redirects : 1
	}).edit(function() {
		// console.trace(wiki);
		var messages = [], listed = 0, all = 0,
		//
		data = processed_data[processed_data.KEY_DATA];
		// data: 結果報告。
		// data[local title] = { id : 0, error : {
		// "error name" : [ "error message", "error message", ...],
		// "error name" : [ ... ], ... }
		// })
		for ( var title in data) {
			all++;
			// log limit
			if (messages.length > 6e3
			// template 若存有已存在本地條目之跨語言連結模板，常常會影響數十個嵌入的條目，因此盡量顯示之。
			&& !/^template:/i.test(title)) {
				CeL.log('Skip log of ' + CeL.wiki.title_link_of(title));
				continue;
			}
			listed++;

			var report = data[title],
			//
			error_messages = report.error;
			if (!error_messages) {
				// no error
				continue;
			}

			// TODO: +'<span class="plainlinks">'
			messages.push('; '
			// + 'Special:Redirect/revision/' + report.id + '|'
			+ CeL.wiki.title_link_of(title)
			// https://en.wikipedia.org/wiki/Help:Link#Links_containing_URL_query_strings
			// an external link rather than as an wikilink
			// TODO: use {{fullurl}}
			+ ' ([{{fullurl:' + title + '|action=edit}} '
			// gettext_config:{"id":"edit-mark"}
			+ gettext('edit-mark') + '])');

			Object.keys(error_messages).sort().forEach(function(error_name) {
				messages.push(':; ' + error_name);
				var list = error_messages[error_name];
				if (list.length > 20) {
					messages.append(list.slice(0, 20));
					messages.push(':: ' + gettext(
					// gettext_config:{"id":"a-total-of-$1-occurrences"}
					'... A total of %1 {{PLURAL:%1|occurrence|occurrences}}.'
					//
					, list.length));
				} else {
					messages.append(list);
				}
			});
		}

		if (messages.length > 0) {
			messages.unshift('List ' + (listed === all ? 'all ' + all
			//
			: listed + '/' + all + ' (' + (100 * listed / all | 0) + '%)')
			// 本次報告僅列出所有出問題頁面的大約 ?%。
			+ ' of all problematic pages.',
			//
			message_set.report_notification + '\n'
			// [[WP:DBR]]: 使用<onlyinclude>包裹更新時間戳。
			+ '* ' + gettext(
			// gettext_config:{"id":"report-generation-date-$1"}
			'Report generation date: %1', '<onlyinclude>~~~~~</onlyinclude>')
			//
			+ '\n'
			// + '== Problematic pages ==\n'
			);
			this.summary += ' ' + listed + '/' + all;
			if (message_set.fix_category) {
				messages.push('[[' + message_set.fix_category + ']]');
			}
		} else {
			// Nothing to report.
		}
		return messages.join('\n');

	}, {
		// section : 'new',
		// sectiontitle : '結果報告',
		summary : gettext(
		// gettext_config:{"id":"cleanup-report-for-interlanguage-link-templates"}
		'Cleanup report for interlanguage link templates'),
		nocreate : 1,
		bot : 1
	});

	// Finally: Write to cache file.
	processed_data.write();

	// done. 結束作業。
}

function for_each_page(page_data, messages) {
	// TODO: 處理模板，並 action=purge&forcelinkupdate=1 更新所有包含模板的頁面
	// https://doc.wikimedia.org/mediawiki-core/master/php/ApiPurge_8php_source.html

	// page_data =
	// {pageid:0,ns:0,title:'',revisions:[{revid:0,parentid:0,user:'',timestamp:''},...]}

	var template_count = 0, template_parsed,
	/** {String}page title = page_data.title */
	title = CeL.wiki.title_of(page_data),
	// 記錄確認已經有改變的文字連結。
	changed = [];
	// console.log(CeL.wiki.content_of(page_data));
	if (false) {
		CeL.log_temporary('' + CeL.wiki.title_link_of(title) + ': ');
	}

	if (!ignore_ns && page_data.ns !== 0
	// file / image
	&& page_data.ns !== 6
	// category: 可考慮去掉 message_set.Category_has_local_page
	&& page_data.ns !== 14
	// Wikipedia
	&& (page_data.ns !== 4 ||
	// e.g., [[Wikipedia:典范条目/存档]]
	/^Wikipedia:(?:典范条目|典範條目|特色內容|特色圖片|特色列表|優良條目|优良条目)/.test(title))
	// template
	&& (page_data.ns !== 10
	// 不處理跨語言連結模板系列。
	|| (title.replace(/\/[\s\S]*$/, '').replace(/^[^:]+:/, '').toLowerCase()
	// 去掉 namespace。
	in message_set.template_order_of_name))) {
		check_final_work();
		return [ CeL.wiki.edit.cancel, '本作業僅處理條目命名空間、模板、Category 或 Wikipedia' ];
	}

	// Check if page_data had processed useing revid.
	if (processed_data.had(page_data)) {
		check_final_work();
		return;
	}

	var overall_resolve, overall_reject;
	function denote_page_processed() {
		// console.trace('denote_page_processed');
		overall_resolve();
		// check_final_work() 得要放在本函數 return 之前執行。
		// setTimeout(): 您不能在 callback 中呼叫 .edit() 之類的 wiki 函數！
		// 請在 callback 執行完畢後再執行新的 wiki 函數！
		setTimeout(check_final_work, 0);
	}

	function for_each_template(token, token_index, token_parent) {
		var parameters, normalized_param = normalize_parameter(token), local_title, foreign_language, foreign_title,
		// The Wikidata entity id
		WD;

		/**
		 * 每一個頁面的最終處理函數。需要用到 token。
		 * 
		 * 警告: 必須保證每個 template 結束處理時都剛好執行一次 check_page。
		 * 
		 * @param {String}error_name
		 *            error message.
		 * @param {String}is_information
		 *            It's an information instead of error.
		 */
		function check_page(error_name, is_information) {
			// 初始化本頁之 processed data: 只要處理過，無論成功失敗都作登記。
			var data_to_cache = processed_data.data_of(page_data);

			if (error_name && !is_information) {
				if (!is_information) {
					CeL.log('check_page: ' + error_name + ' @ '
							+ CeL.wiki.title_link_of(title) + ': '
							+ token.toString());
					if (token.error_message) {
						CeL.log(String(token.error_message));
					}
				}

				// 初始化報告。
				// error message list
				var error_list = data_to_cache[is_information ? 'info'
						: 'error'];
				if (!error_list) {
					data_to_cache[is_information ? 'info' : 'error'] = error_list = Object
							.create(null);
				}
				if (!error_list[error_name]) {
					error_list[error_name] = [];
				}
				error_list = error_list[error_name];

				var parent = token, index = normalized_param.index_order.foreign_title, foreign_title = parent[index];
				if (Array.isArray(foreign_title)) {
					parent = foreign_title;
					index = 0;
					foreign_title = parent[index];
				}

				// 格式化連結。
				if (foreign_title
						&& typeof foreign_title === 'string'
						&& !foreign_title.includes('=')
						&& normalized_param.foreign_language
						&& /^[a-z\-]{2,20}$/
								.test(normalized_param.foreign_language)) {
					CeL.debug('parent[' + index + '] : ' + parent[index]
							+ '→[[:' + normalized_param.foreign_language + ':'
							+ foreign_title + '|' + foreign_title + ']]', 3,
							'check_page');
					parent[index] = '[[:' + normalized_param.foreign_language
							+ ':' + foreign_title + '|' + foreign_title + ']]';
				}

				// cache 以在之後回復 recover 用。
				// console.trace(normalized_param);
				var local_title = normalized_param.local_title,
				//
				local_title_index = normalized_param.index_order.local_title;
				if (local_title && (typeof local_title === 'string')) {
					CeL.debug('token[' + local_title_index + '] : '
							+ token[local_title_index] + '→'
							+ CeL.wiki.title_link_of(local_title), 3,
							'check_page');
					token[local_title_index] = CeL.wiki
							.title_link_of(local_title);
				}
				error_list.push(
				// @see wiki_toString @ CeL.wiki
				': <span style="color:#aaa;padding:.2em">{{</span>'
				//
				+ token.map(function(text) {
					return text.toString().replace(/</g, '&lt;')
					//
					.replace(/^([a-z]+=)/i,
					//
					'<span style="color:#6b5;padding-right:.2em">$1</span>');
				}).join('<b style="color:#f40;padding:.2em">|</b>')
						+ '<span style="color:#aaa;padding:.2em">}}</span>');
				if (token.error_message) {
					error_list.push(token.error_message);
				}

				// console.trace(token);
				// 回復 recover: 因為其他模板可能被置換，最後 .toString() 會重新使用所有資訊，因此務必回復原先資訊！
				if (local_title_index in token) {
					CeL.debug('recover: token[' + local_title_index + '] = '
							+ local_title, 3, 'check_page');
					token[local_title_index] = local_title;
				}
				if (index in parent) {
					CeL.debug('recover: parent[' + index + '] = '
							+ foreign_title, 3, 'check_page');
					parent[index] = foreign_title;
				}
				// console.trace(token);
			}

			CeL.debug('template_count: ' + template_count + ' / page_remains: '
					+ page_remains, 2, 'check_page');

			if (--template_count > 0 || !template_parsed) {
				return;
			}

			CeL.debug('從這裡起，一個頁面應該只會執行一次: ' + CeL.wiki.title_link_of(title)
					+ ' / ' + page_remains, 2, 'check_page');

			if (changed.length === 0) {
				denote_page_processed();
				return;
			}

			// console.trace(parser);
			var last_content = parser.toString();
			if (CeL.wiki.content_of(page_data) === last_content) {
				CeL.warn('The contents are the same.');
				denote_page_processed();
				return;
			}

			// for debug
			if (false) {
				CeL.log('modify ' + CeL.wiki.title_link_of(title) + ': ');
				// CeL.log(last_content);
				denote_page_processed();
				return;
			}

			// console.trace(page_data);
			// console.log(last_content);
			wiki.page(page_data
			// && 'Wikipedia:サンドボックス'
			).edit(last_content, {
				// section : 'new',
				// sectiontitle : title,
				// [[内部リンク]]. cf. [[Help:言語間リンク#本文中]]
				// gettext_config:{"id":"convert-$1-to-wikilink"}
				summary : gettext('Convert %1 to wikilink',
				// gettext_config:{"id":"Comma-separator"}
				changed.join(gettext('Comma-separator'))),
				nocreate : 1,
				minor : 1,
				bot : 1
			}, denote_page_processed);
		}

		function modify_link(link_target) {
			// @see [[:en:Template:illm]], [[:ja:Template:仮リンク]]
			if (parameters.preserve || parameters.display) {
				check_page(message_set.preserved, true);
				return;
			}

			if (!link_target) {
				link_target = local_title;
			}

			/** {String}link 當前處理的 token 已改成了這段文字。summary 用。 */
			var link = '[[' + link_target,
			// @see [[:en:Template:illm]], [[:ja:Template:仮リンク]],
			// [[:en:Template:ill]]
			/** {String}label text displayed */
			text_displayed = normalized_param.label;
			// console.trace(normalized_param);
			if (text_displayed) {
				if (text_displayed !== link_target) {
					link += '|' + text_displayed;
				}
			} else if (false && /\([^()]+\)$/.test(link_target)) {
				// ↑ 盡可能讓表現/顯示出的文字與原先相同。有必要的話，編輯者會使用 .label。
				// e.g., [[Special:Diff/59967187]]

				// e.g., [[title (type)]] → [[title (type)|title]]
				// 在 <gallery> 中，"[[title (type)|]]" 無效，因此需要明確指定。
				link += '|' + link_target.replace(/\s*\([^()]+\)$/, '');
			}
			link += ']]';

			if (!changed.includes(link)) {
				// console.trace('記錄確認已經有改變的文字連結。');
				changed.push(link);
				CeL.log('modify_link: Adapt @ ' + CeL.wiki.title_link_of(title)
						+ ': ' + token.toString() + ' → ' + link);
			}

			// 實際改變頁面結構。將當前處理的 template token 改成這段 link 文字。
			token_parent[token_index] = link;

			check_page();
		}

		function exclude_talk_page(page_data) {
			if (wiki.is_talk_namespace(page_data)
			// [[利用者‐会話:Kanashimi#Wikipedia空間の投票コメントの書き換え]]
			// Wikipedia空間には投票コメントなど個人の発言が含まれているため修正しないほうがよいでしょう（例えば今回の仮リンクには「当時、記事は存在していなかった」という記号の役割もあります）。もし個人の発言ページを区別するのが困難なのであれば、Wikipedia空間全体をノート同様に書き換え禁止としたほうが安全です。
			|| page_data.title.startsWith('Wikipedia:削除依頼/')) {
				check_page(message_set.skip_talk_pages);
				return;
			}
			modify_link();
		}

		// 檢查本地頁面是否創建夠久(7天)，跳過一禮拜內新建（或有更新）頁面，有刪除模板的亦跳過之。
		// TODO: 並且檢查沒掛上刪除模板。
		// TODO: リンク先が曖昧さ回避であるもの（{{要曖昧さ回避}}が後置されている場合も有り）
		function check_local_creation_date(converted_local_title) {
			if (false) {
				console.trace([ converted_local_title, title, foreign_language,
						foreign_title ]);
			}
			wiki.page(converted_local_title, function(page_data) {
				// console.trace(page_data);
				// console.trace(page_data.response.query.redirects);
				// console.trace(CeL.wiki.content_of(page_data));
				if (page_data.title === title) {
					// @see [[w:en:MOS:CIRCULAR]]
					CeL.info('Skip '
							+ CeL.wiki.title_link_of(converted_local_title)
							+ ': ' + message_set.redirect_back_to_page_itself);
					check_page(message_set.redirect_back_to_page_itself);

				} else if (Date.now() - page_data.creation_Date > 7 * 24 * 60
						* 60 * 1000) {
					exclude_talk_page(page_data);

				} else {
					CeL.info('Skip '
							+ CeL.wiki.title_link_of(converted_local_title)
							+ ': ' + message_set.local_title_too_new);
					check_page(message_set.local_title_too_new, true);
				}
			}, {
				// 順便取得頁面內容。
				// prop : 'revisions',
				prop : '',
				redirects : 1,
				// save_response : true,
				get_creation_Date : true
			});
		}

		function for_local_page(converted_local_title) {
			// converted_local_title: foreign_title 所對應的本地條目。
			if (!converted_local_title || converted_local_title !== local_title) {
				// TODO: {{仮リンク|譲渡性個別割当制度|en|Individual fishing quota}}
				// → [[漁獲可能量|譲渡性個別割当制度]]

				// TODO: 處理繁簡轉換的情況:有可能目標頁面存在，只是繁簡不一樣。
				wiki.redirect_to(local_title,
				// 檢查 parameters 指定的本地連結 local_title 是否最終也導向
				// converted_local_title。
				function(redirect_data, page_data) {
					if (false) {
						console.trace(converted_local_title);
						console.log('redirect_data of ' + local_title + ': '
								+ JSON.stringify(redirect_data));
					}
					if (!converted_local_title) {
						// 從外語言條目連結無法取得本地頁面的情況。
						if (redirect_data) {
							// 存在本地頁面。e.g., redirected page
							check_page(message_set.missing_converted_local);
						} else {
							// 忽略本地頁面不存在，且從外語言條目連結無法取得本地頁面的情況。
							// 此應屬正常。
							check_page('Both Not exist', true);
						}
						return;
					}

					if (Array.isArray(redirect_data)) {
						// TODO: Array.isArray(redirect_data)
						console.log(redirect_data);
						throw new Error('Array.isArray(redirect_data)');
					}
					if (redirect_data && redirect_data.to_link) {
						// is #REDIRECT [[title#section]]
						redirect_data = redirect_data.to_link;
					}

					// assert: 若 ((converted_local_title === redirect_data))，
					// 則本地頁面 converted_local_title 存在。
					if (converted_local_title === redirect_data) {
						// local_title 最終導向 redirect_data ===
						// converted_local_title。
						// 直接採用 parameters 指定的 title，不再多做改變；
						// 盡可能讓表現/顯示出的文字與原先相同。
						// e.g., [[Special:Diff/59964828]]
						// TODO: [[Special:Diff/59964827]]
						check_local_creation_date(converted_local_title);
						return;

						// ↓ deprecated
						if (!parameters.label) {
							// 盡可能讓表現/顯示出的文字與原先相同。
							parameters.label = local_title;
						}
						// local_title 最終導向 redirect_data ===
						// converted_local_title。
						local_title = redirect_data;
						// [[local_title]] redirect to:
						// [[redirect_data]] = [[converted_local_title]]
						for_local_page(converted_local_title);
					}

					token.error_message
					//
					= redirect_data ? redirect_data === local_title ? ''
							: ' → ' + CeL.wiki.title_link_of(redirect_data)
							: ': ' + message_set.not_exist;
					token.error_message = ':: '
							+ message_set.from_parameter
							+ ': '
							+ CeL.wiki.title_link_of(local_title)
							+ ' '
							+ token.error_message
							+ '. '
							+ message_set.translated_from_foreign_title
							+ ': '
							+ (converted_local_title ? CeL.wiki
									.title_link_of(converted_local_title)
									: message_set.not_exist);

					// test:
					// <!-- リダイレクト先の「[[...]]」は、[[:en:...]] とリンク -->
					check_page(message_set.different_local_title);
				});
				return;
			}

			// TODO: {{enlink}}

			check_local_creation_date(converted_local_title);
		}

		function for_foreign_page(foreign_page_data) {
			if (!CeL.wiki.content_of.page_exists(foreign_page_data)) {
				check_page(message_set.missing_foreign);
				return;
			}

			if (!foreign_page_data.pageprops) {
				CeL.warn(
				// 沒 .pageprops 的似乎大多是沒有 Wikidata entity 的？
				'for_foreign_page: No foreign_page_data.pageprops: [[:'
						+ foreign_language + ':' + foreign_title + ']] @ '
						+ CeL.wiki.title_link_of(title));
			} else if ('disambiguation' in foreign_page_data.pageprops) {
				check_page(message_set.foreign_is_disambiguation);
				return;
			}

			// @see wiki_API.redirect_to
			// e.g., [ { from: 'AA', to: 'A', tofragment: 'aa' } ]
			var redirect_data = foreign_page_data.response.query.redirects;
			if (redirect_data) {
				if (redirect_data.length !== 1) {
					CeL.warn('for_foreign_page: Get ' + redirect_data.length
							+ ' redirect links for '
							+ CeL.wiki.title_link_of(title) + '!');
					console.log(redirect_data);
				}
				// 僅取用第一筆資料。
				redirect_data = redirect_data[0];
				// test #REDIRECT [[title#section]]
				if (redirect_data.tofragment) {
					check_page(message_set.foreign_redirect_to_section);
					return;
				}
			}

			if (foreign_page_data.title !== foreign_title) {
				// 他言語版項目リンク先が違う記事。
				// 照理來說應該是重定向頁面。
				if (!foreign_page_data.title
						|| foreign_title.toLowerCase() !== foreign_page_data.title
								.toLowerCase()) {
					CeL.log('for_foreign_page: different foreign title: '
							+ CeL.wiki.title_link_of(foreign_language + ':'
									+ foreign_title)
							+ ' → '
							+ CeL.wiki.title_link_of(foreign_language + ':'
									+ foreign_page_data.title) + ' @ '
							+ CeL.wiki.title_link_of(title)
							+ ' (continue task)');
				}
				foreign_title = foreign_page_data.title;
			}

			if (false) {
				console.trace([ foreign_language, foreign_title,
						foreign_page_data ]);
			}
			CeL.wiki.langlinks([ foreign_language,
			// check the Interlanguage link.
			foreign_title ], for_local_page, use_language, {
				redirects : 1
			});

		}

		function for_WD(entity, error) {
			if (error || !entity) {
				check_page(message_set.missing_foreign);
				return;
			}

			if (CeL.wiki.data.is_DAB(entity)) {
				check_page(message_set.foreign_is_disambiguation);
				return;
			}

			for_local_page(CeL.wiki.data.title_of(entity, use_language));
		}

		// ----------------------------
		// main work for each link

		if (normalized_param) {
			// console.trace(normalized_param);
			template_count++;
			token.page_data = page_data;
			// console.log(token);
			parameters = token.parameters;
			local_title = normalized_param.local_title;
			foreign_language = normalized_param.foreign_language;
			foreign_title = normalized_param.foreign_title;
			WD = normalized_param.WD;
			CeL.debug('normalized_param: ' + JSON.stringify(normalized_param));

			if (foreign_language && foreign_language.includes('{')
			//
			&& !foreign_language.includes('}')) {
				CeL.error('parser error @ '
				//
				+ CeL.wiki.title_link_of(title) + '?');
				console.log(token);
			}

			if (local_title && foreign_language && foreign_title) {
				// 這裡用太多 CeL.wiki.page() 並列處理，會造成 error.code "EMFILE"。
				wiki.page([ foreign_language, foreign_title ],
				//
				for_foreign_page, {
					query_props : 'pageprops',
					redirects : 1,
					save_response : true,
					get_URL_options : {
						onfail : function(error) {
							CeL.error('for_each_page: get_URL error: '
									+ CeL.wiki.title_link_of(foreign_language
											+ ':' + foreign_title) + ':');
							console.error(error);
							if (error.code === 'ENOTFOUND'
							//
							&& CeL.wiki.wmflabs) {
								// 若在 Tool Labs 取得 wikipedia 的資料，
								// 卻遇上 domain name not found，
								// 通常表示 language (API_URL) 設定錯誤。
								check_page(gettext(
								// gettext_config:{"id":"syntax-error-in-the-interlanguage-link-template"}
								'Syntax error in the interlanguage link template.'
								//
								));
							} else {
								check_page(message_set.retrive_foreign_error);
							}
							/**
							 * do next action. 警告: 若是自行設定 .onfail，則需要自行善後。
							 * 例如可能得在最後自行執行(手動呼叫) wiki.next()， 使
							 * wiki_API.prototype.next() 知道應當重新啟動以處理 queue。
							 */
							wiki.next();
						}
					}
				});

			} else if (local_title && WD) {
				if (foreign_language) {
					CeL.warn('for_each_page: Using language ['
							+ foreign_language + '] in '
							+ CeL.wiki.title_link_of('d:' + WD) + ' @ '
							+ CeL.wiki.title_link_of(title) + '.');
				}
				// for [[d:Q1]]
				foreign_language = 'd';
				wiki.data(WD, for_WD, {
					get_URL_options : {
						onfail : function(error) {
							// TODO
							throw error;
						}
					}
				});

			} else if (local_title && !foreign_title
			// 確保 foreign_language 非 title。
			&& (!foreign_language || /^[a-z]{2}$/.test(foreign_language))) {
				wiki.redirect_to(local_title,
				//
				function(redirect_data, page_data) {
					if (Array.isArray(redirect_data)) {
						// TODO: Array.isArray(redirect_data)
						console.log(redirect_data);
						throw new Error('Array.isArray(redirect_data)');
					}
					if (!redirect_data) {
						check_page(message_set.invalid_template);
						return;
					}

					// e.g., {{仮リンク|存在する記事}}, {{仮リンク|存在する記事|en}}
					check_local_creation_date(local_title);
				});

			} else {
				setImmediate(function() {
					check_page(message_set.invalid_template);
				});
			}
		}

	}

	// 這一步頗耗時間。
	var parser = CeL.wiki.parser(page_data).parse();
	if (CeL.wiki.content_of(page_data) !== parser.toString()) {
		// debug 用. check parser, test if parser working properly.
		throw new Error('Parser error: ' + CeL.wiki.title_link_of(page_data));
	}
	parser.each('template', for_each_template);
	template_parsed = true;
	if (template_count === 0) {
		CeL
				.warn([
						'for_each_page: ',
						CeL.wiki.title_link_of(title) + ': ',
						{
							// 記事が読み込んでいるテンプレートの方に仮リンクが使われている場合もあります。
							// gettext_config:{"id":"no-registered-interwiki-link-templates-were-found"}
							T : 'No registered interwiki link templates were found.'
						},
						{
							T :
							// gettext_config:{"id":"maybe-there-are-unregistered-interwiki-link-templates-or-some-transcluded-templates-articles-with-interwiki-link-templates-that-have-local-articles-(usually-in-the-last-section-of-the-page)"}
							'Maybe there are unregistered interwiki link templates, or some transcluded templates/articles with interwiki link templates that have local articles (usually in the last section of the page)?'
						} ]);
		// check_page(message_set.no_template);
		check_final_work();
		return;
	}

	return new Promise(function(resolve, reject) {
		overall_resolve = resolve;
		overall_reject = reject;
	});
}

// ----------------------------------------------------------------------------

// 先創建出/準備好本任務獨有的目錄，以便後續將所有的衍生檔案，如記錄檔、cache 等置放此目錄下。
prepare_directory(base_directory, true);

// CeL.set_debug(2);

function main_work() {
	CeL.wiki.cache([ {
		type : 'categorymembers',
		list : message_set.Category_has_local_page,
		reget : true,
		operator : function(list) {
			this.list = list;
			// console.log(this.list);

			// only for debug {{ill}}s on specified page
			// this.list = [ 'Wikipedia:沙盒' ];
			// this.list = [ 'Wikipedia:サンドボックス' ];
		}

	}, false && {
		// 使用 cache page 的方法速度過慢！
		type : 'page'

	} ], function() {
		var list = this.list;
		// list = [ '' ];
		// list = [ 'Wikipedia:Sandbox' ];
		CeL.log('Get ' + list.length + ' pages.');
		if (false) {
			ignore_ns = true;
			CeL.log(list.slice(0, 8).map(function(page_data, index) {
				return index + ': ' + CeL.wiki.title_of(page_data);
			}).join('\n') + '\n...');
			// 設定此初始值，可跳過之前已經處理過的。
			list = list.slice(0 * test_limit, 1 * test_limit);
		}

		// CeL.set_debug(6);
		// setup ((page_remains))
		page_remains = list.length;
		wiki.work({
			no_edit : true,
			each : for_each_page,
			page_options : {
				rvprop : 'ids|content|timestamp'
			}

		}, list);

	}, {
		// default options === this
		// TODO: add Wikipedia:優良條目/存檔
		// namespace : '0|10|14',
		// [SESSION_KEY]
		session : wiki,
		// title_prefix : 'Template:',
		// cache path prefix
		prefix : base_directory
	});
}

wiki.run(main_work);
