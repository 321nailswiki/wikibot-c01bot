﻿/*

 	完成。正式運用。轉成常態性工具。


 */

'use strict';

// Load CeJS library and modules.
require('./wiki loder.js');

// Set default language. 改變預設之語言。 e.g., 'zh'
set_language('ja');

/** {String}預設之編輯摘要。總結報告。編集内容の要約。 */
summary = 'Synchronize data of books';

var
/** {Object}wiki operator 操作子. */
wiki = Wiki(true),

/** {revision_cacher}記錄處理過的文章。 */
processed_data = new CeL.wiki.revision_cacher(base_directory + 'processed.'
		+ use_language + '.json'),

// ((Infinity)) for do all
test_limit = 200,

set_properties = ('題名,著者,本国,ジャンル,前作,次作,公式サイト'
// 以下為配合各自版本的屬性
+ ',挿絵画家,分類,作品の使用言語,出版日,発行者,ページ数').split(','),
//
set_properties_hash = CeL.null_Object(),

all_properties = {
	題名 : 'title',
	著者 : 'author',
	// 著作物の本国
	本国 : 'country',
	// 原語 : 'P364',
	//
	// ジャンル or: 著作物の主題 (P921): e.g., "[[紀伝体]]の歴史書", "[[長編小説]]",
	// "長編小説、ファンタジー小説、ハイ・ファンタジー、冒険小説"
	ジャンル : 'genre',
	前作 : 'preceded_by',
	次作 : 'followed_by',
	公式サイト : 'website',

	// id 會另外處置，不放在((set_properties))中。
	// {{ISBN|...}}
	'ISBN-13' : 'id',
	'ISBN-10' : 'id',
	// {{NCID|...}}
	'CiNii book ID' : 'id',
	// {{OCLC|...}}
	OCLC : 'id',

	// 以下為配合各自版本的屬性
	// 原版之插畫家。但即使原版也應算做版本之一，因此除非原作品已不可能再版，否則還是應該設定於該版本下。
	挿絵画家 : 'illustrator',
	// "訳者"應該配合各版本。須配合各版本的屬性，不應直接設定於主屬性下，而該設定於該版本下。
	訳者 : 'translator',
	// 形態: e.g., "[[上製本]]・並製本"
	分類 : 'type',
	作品の使用言語 : 'language',
	出版日 : 'published',
	発行者 : 'publisher',
	ページ数 : 'pages',

	imported_from : ''
},
//
all_properties_array = Object.keys(all_properties),

//
PATTERN_ISBN_1 = /{{ *ISBN *\|([^{}]+)}}/ig, PATTERN_ISBN_2 = /ISBN {0,2}([\d-]+X?)/ig,
//
PATTERN_NCID = /{{ *NCID *\|([^{}]+)}}/g, PATTERN_OCLC = /{{ *OCLC *\|([^{}]+)}}/g;

function add_property(object, key, value) {
	if (key in object) {
		var old = object[key];
		if (Array.isArray(old)) {
			if (!old.includes(value)) {
				old.push(value);
			}
		} else if (old !== value) {
			object[key] = [ old, value ];
		}
	} else {
		object[key] = value;
	}
}

function add_ISBN(matched, data) {
	if (matched && (matched = matched[1].replace(/-/g, '').trim())) {
		if (matched.length === 13 || matched.length === 10) {
			add_property(data, 'ISBN-' + matched.length, matched);
		} else {
			CeL.err('Invalid ISBN: ' + matched);
		}
	}
}

function for_each_page(page_data, messages) {
	if (!page_data || ('missing' in page_data)) {
		// error?
		return [ CeL.wiki.edit.cancel, '條目已不存在或被刪除' ];
	}

	if (page_data.ns !== 0) {
		throw '非條目:[[' + page_data.title + ']]! 照理來說不應該出現有 ns !== 0 的情況。';
	}

	/** {String}page title = page_data.title */
	var title = CeL.wiki.title_of(page_data),
	/**
	 * {String}page content, maybe undefined. 條目/頁面內容 = revision['*']
	 */
	content = CeL.wiki.content_of(page_data);

	if (!content) {
		return [ CeL.wiki.edit.cancel,
				'No contents: [[' + title + ']]! 沒有頁面內容！' ];
	}

	var parser = CeL.wiki.parser(page_data);
	if (CeL.wiki.content_of(page_data) !== parser.toString()) {
		// debug 用. check parser, test if parser working properly.
		throw 'Parser error: [[' + page_data.title + ']]';
	}

	function for_data_template(token) {
		if (token.name !== '基礎情報 書籍') {
			return;
		}

		var parameters = token.parameters, book_title = (parameters.title
				&& parameters.title.toString() || page_data.title).replace(
				/^『(.+)』$/, '$1').trim();
		// console.log(book_title);
		wiki.page(page_data).edit_data(function(entity) {
			var data_title = entity.value('label');
			if (data_title && data_title !== book_title) {
				CeL.err(
				//
				'Different title: [[' + parameters.title + ']]'
				//
				+ (book_title === parameters.title ? ''
				//
				: ' (' + book_title + ')')
				//
				+ ' vs. data: [' + data_title + ']');
			}

			// id:
			CeL.debug(JSON.stringify(entity), 3);
			CeL.debug(JSON.stringify(entity.value(all_properties)), 2);

			var data = CeL.null_Object();

			for ( var parameter in set_properties_hash) {
				var value = parameters[parameter];
				if (value && (value = CeL.wiki.plain_text(value.toString()))) {
					data[set_properties_hash[parameter]]
					// e.g., data.P50 = 'ABC'
					= value;
				}
			}

			if (parameters.id) {
				var id = parameters.id.toString(), matched;
				while (matched = PATTERN_ISBN_1.exec(id)) {
					add_ISBN(matched, data);
				}
				while (matched = PATTERN_ISBN_2.exec(id)) {
					add_ISBN(matched, data);
				}

				while (matched = PATTERN_NCID.exec(id)) {
					add_property(data, 'CiNii book ID', matched[1].trim());
				}
				while (matched = PATTERN_OCLC.exec(id)) {
					add_property(data, 'OCLC', matched[1].trim());
				}
			}

			if (CeL.is_empty_object(data)) {
				return [ CeL.wiki.edit.cancel, 'skip' ];
			}

			data.references = {
				imported_from : 'jawiki'
			};
			CeL.log(JSON.stringify(data));
		});
	}

	parser.each('template', for_data_template);
}

// ----------------------------------------------------------------------------

// CeL.set_debug(2);

prepare_directory(base_directory);

var old_properties = 'P1476,P50,P495,P136,P155,P156,P856,P212,P957,P1739,P243,P110,P655,P31,P407,P577,P123,P1104,P143';

// console.log(all_properties_array.join(','));
CeL.wiki.data.search.use_cache(all_properties_array, function(id_list) {
	if (id_list.join(',') !== old_properties) {
		CeL.err('Different properties:\nold: ' + old_properties + '\nnew: '
				+ id_list.join(','));
		return;
	}

	set_properties.forEach(function(property) {
		var index = all_properties_array.indexOf(property);
		if (!(index in id_list)) {
			throw 'Not found: ' + property;
		}
		// e.g., 著者: .author = 'P50'
		set_properties_hash[all_properties[property]]
		// 採用屬性名稱/id
		// = id_list[index]
		= property;
	});
	// console.log(JSON.stringify(set_properties_hash));

	CeL.wiki.cache([ {
		type : 'embeddedin',
		list : 'Template:基礎情報 書籍',
		reget : true,
		operator : function(list) {
			this.list = list;
		}

	} ], function() {
		var list = this.list;
		// list = [ '' ];
		CeL.log('Get ' + list.length + ' pages.');
		if (1) {
			// 設定此初始值，可跳過之前已經處理過的。
			list = list.slice(0 * test_limit, 1 * test_limit);
			CeL.log(list.slice(0, 8).map(function(page_data) {
				return CeL.wiki.title_of(page_data);
			}).join('\n') + '\n...');
		}

		wiki.work({
			each : for_each_page,
			// 不作編輯作業。
			no_edit : true,
			summary : summary
		}, list);

	}, {
		// default options === this
		namespace : 0,
		// [SESSION_KEY]
		session : wiki,
		// title_prefix : 'Template:',
		// cache path prefix
		prefix : base_directory
	});

}, {
	session : wiki
});
