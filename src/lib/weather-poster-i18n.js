import { ALL_ADVICE } from './weather-advice.js';
import { ADVICE_ZH, ADVICE_MY, ADVICE_RU } from './weather-advice-translations.js';

const ko={lang:'ko',name:'한국어',locale:'ko-KR',font:'Poster Korean',header:'현장 기상 · 건강 안내',site:'현장',today:'오늘의 날씨',high:'최고 기온',low:'최저 기온',feelHigh:'최고 체감온도',windHigh:'최대 풍속',hourly:'시간별 예보',period:'모든 기온·체감온도·풍속은 06–19시 예보 기준',temp:'기온',feel:'체감',wind:'풍속',time:'시간',tips:'오늘 챙길 것',preview:'미리보기 예시 · 실제 날씨가 아닙니다.',source:'출처 Open-Meteo · 현장 저장 좌표 기준 · 실제 관측값과 다를 수 있습니다.',note:'경고는 현장 설정 기준이며 기상청 특보와 다릅니다. — 미제공',chart:'시간별 기온·체감온도 선 그래프와 풍속 막대 그래프',heat1:'더위 주의',heat2:'더위 경계',heat3:'더위 위험',cold1:'추위 주의',cold2:'추위 경고',wind1:'강풍 주의',above:'이상',below:'이하',hourSuffix:'시'};
const zh={lang:'zh',name:'中文',locale:'zh-CN',font:'Poster Chinese',header:'工地天气与健康提示',site:'工地',today:'今日天气',high:'最高气温',low:'最低气温',feelHigh:'最高体感温度',windHigh:'最大风速',hourly:'逐小时预报',period:'气温、体感温度及风速均为韩国时间 06—19时的预报',temp:'气温',feel:'体感',wind:'风速',time:'时间',tips:'今天要注意',preview:'预览示例，并非实际天气。',source:'来源 Open-Meteo · 按工地保存的坐标预报，可能与实测值不同。',note:'提示采用工地设定的标准，并非韩国气象厅预警。— 表示无数据',chart:'气温、体感温度折线图及风速柱状图',heat1:'高温注意',heat2:'高温警戒',heat3:'高温危险',cold1:'低温注意',cold2:'低温警告',wind1:'大风注意',above:'及以上',below:'及以下',hourSuffix:'时'};
const my={lang:'my',name:'မြန်မာ',locale:'my-MM',font:'Poster Myanmar',header:'လုပ်ငန်းခွင် မိုးလေဝသနှင့် ကျန်းမာရေး',site:'လုပ်ငန်းခွင်',today:'ယနေ့ မိုးလေဝသ',high:'အမြင့်ဆုံး အပူချိန်',low:'အနိမ့်ဆုံး အပူချိန်',feelHigh:'အမြင့်ဆုံး ခံစားရသည့်အပူချိန်',windHigh:'အမြင့်ဆုံး လေတိုက်နှုန်း',hourly:'တစ်နာရီချင်း ခန့်မှန်းချက်',period:'အပူချိန်နှင့် လေတိုက်နှုန်းများသည် ကိုရီးယားစံတော်ချိန် 06–19 နာရီအတွက် ခန့်မှန်းချက်များဖြစ်သည်။',temp:'အပူချိန်',feel:'ခံစားရမှု',wind:'လေတိုက်နှုန်း',time:'အချိန်',tips:'ဒီနေ့ အရင်ပြင်ဆင်ကြစို့',preview:'နမူနာပြသမှုသာ ဖြစ်ပြီး တကယ့်မိုးလေဝသ မဟုတ်ပါ။',source:'ရင်းမြစ် Open-Meteo · သိမ်းထားသည့် လုပ်ငန်းခွင်တည်နေရာအရ ခန့်မှန်းထားပြီး လက်တွေ့တိုင်းတာချက်နှင့် ကွာနိုင်သည်။',note:'ဤသတိပေးချက်များသည် လုပ်ငန်းခွင်သတ်မှတ်ချက်ဖြစ်ပြီး KMA တရားဝင်သတိပေးချက် မဟုတ်ပါ။ — အချက်အလက်မရှိ',chart:'အပူချိန်နှင့် ခံစားရသည့်အပူချိန် မျဉ်းဂရပ်၊ လေတိုက်နှုန်း ဘားဂရပ်',heat1:'အပူ သတိပြု',heat2:'အပူ အထူးသတိ',heat3:'အပူ အန္တရာယ်',cold1:'အအေး သတိပြု',cold2:'အအေး သတိပေး',wind1:'လေပြင်း သတိပြု',above:'နှင့်အထက်',below:'နှင့်အောက်',hourSuffix:''};
const ru={lang:'ru',name:'Русский',locale:'ru-RU',font:'Poster Russian',header:'Погода и здоровье на объекте',site:'Объект',today:'Погода сегодня',high:'Максимум температуры',low:'Минимум температуры',feelHigh:'Максимум по ощущениям',windHigh:'Максимум скорости ветра',hourly:'Почасовой прогноз',period:'Температура, ощущения и ветер: прогноз на 06–19 ч по времени Кореи',temp:'Темп.',feel:'Ощущ.',wind:'Ветер',time:'Время',tips:'Что взять и о чём помнить',preview:'Пример для просмотра, не фактическая погода.',source:'Источник Open-Meteo · Прогноз по координатам объекта; возможны отличия от наблюдений.',note:'Уведомления по порогам объекта, не официальные предупреждения KMA. — нет данных',chart:'Температура и ощущения: линии; скорость ветра: столбцы',heat1:'Жара: внимание',heat2:'Жара: высокий риск',heat3:'Жара: опасно',cold1:'Холод: внимание',cold2:'Холод: предупреждение',wind1:'Сильный ветер',above:'и выше',below:'и ниже',hourSuffix:''};
export const POSTER_LANGUAGES=[ko,zh,my,ru];
export function posterLocale(lang='ko'){return POSTER_LANGUAGES.find(l=>l.lang===lang)||ko;}
const translations={zh:ADVICE_ZH,my:ADVICE_MY,ru:ADVICE_RU};
export function localizeAdvice(tips,lang='ko'){
 if(lang==='ko')return tips;
 const list=translations[lang];
 if(!list)return tips;
 if(list.length!==ALL_ADVICE.length)throw new Error(`Incomplete ${lang} advice catalog: ${list.length}/${ALL_ADVICE.length}`);
 return tips.map(tip=>{const index=ALL_ADVICE.indexOf(tip);if(index<0||!list[index])throw new Error(`Missing ${lang} advice translation`);return list[index];});
}
export function localizeAlert(alert,lang='ko'){
 const l=posterLocale(lang),number=alert.kind==='wind'?10:alert.kind==='heat'?[31,33,35][alert.level-1]:[-12,-15][alert.level-1];
 return {...alert,label:l[alert.kind+alert.level],threshold:`${number}${alert.kind==='wind'?'m/s':'°C'} ${alert.kind==='cold'?l.below:l.above}`};
}
export function localizedHour(hour,lang='ko'){const l=posterLocale(lang);return `${hour}${l.hourSuffix}`;}
export function posterDateTitle(date,lang='ko'){
 const l=posterLocale(lang),d=new Date(date+'T12:00:00+09:00');
 if(lang==='my')return `${myMonths[d.getUTCMonth()]} ${d.getUTCDate()} · ${l.today}`;
 const md=new Intl.DateTimeFormat(l.locale,{timeZone:'Asia/Seoul',month:'long',day:'numeric'}).format(d);
 return `${md} ${l.today}`;
}

// Some browsers lack Burmese Intl date data; keep the poster fully Burmese there too.
const myMonths=['ဇန်နဝါရီ','ဖေဖော်ဝါရီ','မတ်','ဧပြီ','မေ','ဇွန်','ဇူလိုင်','ဩဂုတ်','စက်တင်ဘာ','အောက်တိုဘာ','နိုဝင်ဘာ','ဒီဇင်ဘာ'];
const myWeekdays=['တနင်္ဂနွေ','တနင်္လာ','အင်္ဂါ','ဗုဒ္ဓဟူး','ကြာသပတေး','သောကြာ','စနေ'];
export function posterDateLabel(date,lang='ko'){
 const d=new Date(date+'T12:00:00+09:00'),l=posterLocale(lang);
 if(lang==='my')return `${d.getUTCFullYear()}၊ ${myMonths[d.getUTCMonth()]} ${d.getUTCDate()}၊ ${myWeekdays[d.getUTCDay()]}`;
 return new Intl.DateTimeFormat(l.locale,{timeZone:'Asia/Seoul',year:'numeric',month:'long',day:'numeric',weekday:'long'}).format(d);
}
