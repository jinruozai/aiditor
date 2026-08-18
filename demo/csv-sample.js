;(function (Demo) {
  'use strict'

  // Plain CSV demo fixture. The standard `csv` format treats the first row as
  // literal column names and every cell as a string.
  Demo.csvSample = `id,name,class,level,cost,rarity,unlocked
1001,小红 1,战士,3,500,普通,true
1002,小红 2,法师,5,1200,稀有,true
1003,小红 3,刺客,4,800,史诗,false
1004,小红 4,游侠,6,1500,传说,true
1005,小红 5,牧师,3,600,普通,true
1006,小红 6,战士,7,2000,稀有,false
1007,小红 7,法师,8,2600,史诗,true
1008,小红 8,刺客,9,3300,传说,true
`
})(window.Demo = window.Demo || {})
