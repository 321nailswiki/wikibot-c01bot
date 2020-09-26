﻿/*

node undo_edit.js use_language=ja

 recover, revert error edit
 連續發生大量編輯錯誤，要回退時使用的工具。

 2019/4/11 13:44	初版試營運

 @see [[m:User:Hoo man/Scripts/Smart rollback]]

 */

'use strict';

globalThis.no_task_date_warning = true;

// Load CeJS library and modules.
require('../wiki loader.js');

/** {Object}wiki operator 操作子. */
var wiki = Wiki(true);

// ---------------------------------------------------------------------//

user_name = CeL.wiki.normalize_title(user_name);

summary = 'revert error made by bot';
// 向前追溯筆數。
var length = 'max';

// fix these edits.
function filter_summary(summary) {
	// console.log(summary);
	// return summary === 'Robot';
	return summary.includes('繡蔣を含む記事の改名に伴うリンク修正依頼');
}

// ---------------------------------------------------------------------//

wiki.usercontribs(user_name, function(list) {
	CeL.log('Get ' + list.length + ' edits from ' + CeL.wiki.site_name(wiki));

	var undo_page_hash = Object.create(null);

	list.reverse();
	// console.log(list);
	list.forEach(function filter_contribs(page_data) {
		if (Date.now() - Date.parse(page_data.timestamp) >
		// filter by date
		1 * 24 * 60 * 60 * 1000) {
			// too old
			return;
		}

		// page_title
		var title = CeL.wiki.title_of(page_data);
		if (false && !page_data.title.includes('世宗 (朝鮮王)')) {
			return;
		}

		if (page_data.comment) {
			if (page_data.comment.includes(summary)) {
				// Already fixed.
				delete undo_page_hash[title];
				return;
			}

			// filter by summary
			if (!filter_summary(page_data.comment)) {
				return;
			}
		}

		// ------------------------------------------------

		undo_page_hash[title] = true;
	});

	list = Object.keys(undo_page_hash);

	CeL.log('' + list.length + ' pages need to test.');

	list.run_serial(for_each_page);

}, {
	limit : length
});

var check_diff = false;
function filter_diff(diff) {
	var plus = diff[0], minus = diff[1];
	// console.log(diff);
	var need_fix = plus
			&& minus
			&& plus.length < minus.length
			&& /\[\[ *(?:File|Fichier|檔案|档案|文件|ファイル|Image|圖像|图像|画像|Media|媒[體体](?:文件)?)/i
					.test(plus);
	if (false && need_fix)
		console.log(diff);
	return need_fix;
}

function for_each_page(run_next, title, index, list) {
	CeL.debug('Test ' + CeL.wiki.title_link_of(title));

	wiki.page(title, function(page_data) {
		// console.log(page_data);

		/** {Object}revision data. 修訂版本資料。 */
		var revision = page_data && page_data.revisions
				&& page_data.revisions[0];

		if (revision.comment && revision.comment.includes(summary)) {
			// Already fixed.
			run_next();
			return;
		}

		if (revision.user !== user_name) {
			CeL.warn(CeL.wiki.title_link_of(page_data) + ' 已被 ' + revision.user
					+ ' 編輯過'
					+ (revision.comment ? ': ' + revision.comment : ''));
			run_next();
			return;
		}

		if (revision.comment && !filter_summary(revision.comment)) {
			run_next();
			return;
		}

		if (check_diff && page_data.revisions[1]) {
			var diff_list = CeL.LCS(CeL.wiki.revision_content(revision),
					CeL.wiki.revision_content(page_data.revisions[1]), 'diff');
			if (!diff_list.some(filter_diff)) {
				run_next();
				return;
			}
			// console.log(diff_list);
		}

		CeL.log('Undo edit on ' + (index + 1) + '/' + list.length + ' '
				+ CeL.wiki.title_link_of(title));
		if (false) {
			run_next();
			return;
		}

		// console.log(page_data.revisions[1]);
		// console.log(CeL.wiki.content_of(page_data, 1));
		// CeL.set_debug(6);
		wiki.page(page_data).edit('', {
			undo : 1,
			bot : 1,
			minor : 1,
			summary : summary
		}).run(run_next);
	}, {
		rvlimit : check_diff ? 2 : 1,
		rvprop : 'ids|content|timestamp|user|comment'
	});

}
