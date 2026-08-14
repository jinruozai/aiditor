// Demo-project TypeConfig overlay used by the GameCSV fixture.
;(function (aiditor) {
  'use strict'
  aiditor.ui.setTypeOverrides({
    music: { name: 'Music', base_type: 'string', type_render: 'snd', default: '', type_agv: { accept: '.mp3,.wav,.ogg' } },
    id_num: { name: 'ID + number', base_type: 'struct', type_render: 'struct', default: [0, 0], struct_def: { id_num: { id: 'ref_id', num: 'int' } } },
    id_string: { name: 'ID + text', base_type: 'struct', type_render: 'struct', default: [0, ''], struct_def: { id_string: { id: 'ref_id', text: 'string' } } },
    string_num: { name: 'Text + number', base_type: 'struct', type_render: 'struct', default: ['', 0], struct_def: { string_num: { text: 'string', num: 'int' } } },
    img_num: { name: 'Image + number', base_type: 'struct', type_render: 'struct', default: ['', 0], struct_def: { img_num: { image: 'img', num: 'int' } } },
    snd_num: { name: 'Audio + number', base_type: 'struct', type_render: 'struct', default: ['', 0], struct_def: { snd_num: { audio: 'snd', num: 'int' } } },
    img_string: { name: 'Image + text', base_type: 'struct', type_render: 'struct', default: ['', ''], struct_def: { img_string: { image: 'img', text: 'string' } } },
    snd_string: { name: 'Audio + text', base_type: 'struct', type_render: 'struct', default: ['', ''], struct_def: { snd_string: { audio: 'snd', text: 'string' } } },
  })
})(window.aiditor = window.aiditor || {})
