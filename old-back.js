const xlsx = require('async-xlsx');//быстрое чтение и запись экселя, возможно этот элемент и не нужен, но теперь уже лучше не трогать
const xlsxConverter = require('xlsx'); //нормальная либа экселя
const fs = require('fs'); //файлы
const util = require('util'); //промисы
const iconv = require('iconv-lite');
const {Client} = require('pg'); //работа с бд
const JSZip = require('jszip'); //работа с архивами zip
const readdir = util.promisify(fs.readdir); //чтобы асинк работал
const writeFile = util.promisify(fs.writeFile); //чтобы асинк работал
const nodemailer = require('nodemailer'); //прослушка почты
const req = require('request');
const emlformat = require('eml-format'); //Для работы с eml
const notifier = require('mail-notifier');

const formula_lib = require('./lib/makeFormula');

const clientPg = new Client({
    host: 'localhost',
    port: 5432,
    user: 'postgres',
    password: '88228228',
    database: 'II'
});

let notify;
clientPg.connect(null, null);

clientPg.query({
    text: 'SELECT * FROM SETTINGS WHERE folder = $1',
    values: ['Почта с прайсами']
})
    .then(result => {
        const imap = {
            user: result.rows.filter(row => row.name === 'Имя пользователя')[0].param,
            password: result.rows.filter(row => row.name === 'Пароль')[0].param,
            host: result.rows.filter(row => row.name === 'Хост')[0].param,
            port: result.rows.filter(row => row.name === 'Порт')[0].param,
            tls: true,
            tlsOptions: {rejectUnauthorized: false},
            search: [['SINCE', new Date(Date.now() - 1000*60*60*24*5)]],
            debug: (e) => {
                if (e.includes('[connection] Error')) {
                    console.log("Ошибка.");
                    notify.stop();
                } else if (e.includes('LOGIN completed')) {
                    console.log("Соединение с почтой установлено!");
                    console.log("Считывание писем с почты...");
                } else if (e.includes('FETCH completed')) {
                    console.log("Все письма cчитаны.");
                    notify.stop();
                } else if (e.includes('*') && e.includes('EXISTS')) {
                    let imapCounter = e.replace(/<= '\* /g, '').replace(/EXISTS'/, '');
                    console.log("Найдено " + imapCounter + "писем.");
                }
            }
        };
        notify = notifier(imap);
    });

function mergeArrays(a1, a2, propLeft, propRight, newLeft, newRight) {

    let parsedFilteredArrayLeft = [];
    let parsedFilteredArray = [];
    //отфильтровали по нужной колонке, чтобы потом фильтрануть по 2 массиву
    for (let i = 0; i < a1.length; i++) {
        parsedFilteredArrayLeft.push('' + a1[i][propLeft])
    }
    let filteredAnswer = a2.filter((elem) => ~parsedFilteredArrayLeft.indexOf('' + elem[propRight]));
    for (let i = 0; i < filteredAnswer.length; i++) {
        parsedFilteredArray.push(filteredAnswer[i][propRight])
    }
    for (let i = 1; i < a1.length; i++) {
        let filter = a1[i][propLeft];
        let filterIndex = parsedFilteredArray.indexOf('' + filter);

        if (~filterIndex) {
            for (let j = 0; j < newLeft.length; j++) {
                a1[i][newLeft[j]] = filteredAnswer[filterIndex][newRight[j]]
            }
        } else {
            for (let j = 0; j < newLeft.length; j++) {
                a1[i][newLeft[j]] = ''
            }
        }

    }
}

async function main() {
    let query = `SELECT convert_rules.id,
                        sender,
                        t.pseudoname AS outer_name,
                        filter,
                        t.filters     AS filters,
                        t.formulas    AS formulas,
                        t.unions      AS unions,
                        h.columns     AS columns,
                        source,
                        title_filter,
                        MAX(upl.date) AS last_date
                 FROM convert_rules
                        LEFT JOIN update_price_log AS upl on convert_rules.id = upl.convert_rule
                        LEFT JOIN templates t on convert_rules.template = t.id
                        LEFT JOIN headers h on convert_rules.headers = h.id
                 WHERE convert_rules.removed = false
                 GROUP BY convert_rules.id, title_filter, pseudoname, filter, sender, template, source, t.filters, h.columns,
                   t.formulas, t.unions
                 ORDER BY convert_rules.id
    `;

    let template = await convertDBQueryToArray(query);
    await mailListen(template);
    await gmMakeRequest(template);

    template = await convertDBQueryToArray(query);
    await makePrices(template);
    clientPg.end();
    return 0;
}

async function writeMail(path, data, date, template, id) {
    return new Promise(async resolve => {
        if (data !== undefined) fs.writeFileSync(path, data);
        let queryUpdate = {
            text: `UPDATE convert_rules
                   SET source = $1
                   WHERE id = $2;`,
            values: [path, id]
        };
        let queryInsert = {
            text: `INSERT INTO update_price_log (date, convert_rule)
                   VALUES ($1, $2)`,
            values: [date, id]
        };
        clientPg.query(queryUpdate)
            .then(() => {
                clientPg.query(queryInsert)
                    .then(() => {
                        console.log('Найден новый прайс ' + template.filter(t => t.id === id)[0].outer_name + ' на ' + date.toLocaleDateString());
                        resolve(template)
                    }, err => console.log(err))
            }, err => console.log(err))
    });
}

async function mailListen(template) {
    return new Promise(resolve => {
        console.log("Попытка подключения к почте...");

        notify
            .on('end', async () => {
                resolve();
            })
            .on('error', async (e) => {
                console.log("Произошла ошибка при работе с почтой. Описание ошибки: \n" + e);
                resolve();
            })
            .on('mail', async function (mail) {

                console.log(mail.from[0].address.toLowerCase() + ' ' + mail.date.toLocaleString());
                await Promise.all(template.map(async (elem) => {
                    return new Promise(async resolve1 => {

                        if (mail.attachments !== undefined && elem.sender !== null
                            && elem.sender.toLowerCase() === mail.from[0].address.toLowerCase() && (elem.last_date === null ? true : elem.last_date < Date.parse(mail.date))) {

                            await Promise.all(mail.attachments.map(attach => {
                                return new Promise(async resolve2 => {
                                    fs.writeFile('./attachments/' + attach.fileName, attach.content, () => {
                                        attach.path = fs.realpathSync('./attachments/' + attach.fileName);
                                        resolve2();
                                    });
                                });
                            }));

                            if (elem.title_filter !== null) {
                                if (!mail.subject.includes(elem.title_filter)) {
                                    resolve1();
                                }
                            }
                            if (elem.filter === null) {
                                let mailPath = mail.attachments["0"].path;
                                if (mailPath.substring(mailPath.lastIndexOf('.') + 1, mailPath.length) === 'eml') {
                                    let eml = fs.readFileSync(mailPath, "utf-8");
                                    emlformat.read(eml, async (error, data) => {

                                        if (error) return console.log(error);
                                        let writePath = mailPath.substring(0, mailPath.lastIndexOf('\\') + 1) + "UAZ-EMAIL.xlsx";
                                        template = await writeMail(writePath, data.attachments["0"].data, mail.date, template, elem.id);
                                        resolve1();
                                    });
                                } else {
                                    if (mailPath.substring(mailPath.lastIndexOf('\\') + 1, mailPath.lastIndexOf('.')) === 'price') {

                                        let buffer = fs.readFileSync(mailPath);
                                        let newName = mailPath.substring(0, mailPath.lastIndexOf('\\') + 1) + elem.outer_name + mailPath.substring(mailPath.lastIndexOf('.'), mailPath.length);
                                        template = await writeMail(newName, buffer, mail.date, template, elem.id)
                                        resolve1();
                                    } else {
                                        template = await writeMail(mailPath, undefined, mail.date, template, elem.id);
                                        resolve1();
                                    }
                                }
                            } else {
                                //Если стоит : в шаблоне, значит это архив, работа с архивом
                                if (elem.filter.includes(':')) {
                                    let elemZip = elem.filter.substring(0, elem.filter.indexOf(':'));
                                    let elemFilter = elem.filter.substring(elem.filter.indexOf(':') + 1, elem.filter.length);
                                    let filteredAttach = mail.attachments.filter((elem2) => elem2.path.includes(elemZip));
                                    if (filteredAttach.length > 0) {

                                        let folder = filteredAttach[0].path.substring(0, filteredAttach[0].path.lastIndexOf('.'));

                                        let data = fs.readFileSync(filteredAttach[0].path);


                                        JSZip.loadAsync(data).then(async function (zip) {
                                            let files = Object.keys(zip.files);
                                            if (files.length > 0) {

                                                if (!fs.existsSync(folder)) {
                                                    fs.mkdirSync(folder);
                                                }
                                            }
                                            await Promise.all(files.map((file) => {
                                                return new Promise(resolve2 => {
                                                    zip.files[file].async('uint8array').then(async (uint8array) => {
                                                        if (file.includes(elemFilter)) {
                                                            template = await writeMail(folder + '\\' + file, uint8array, mail.date, template, elem.id)
                                                            resolve2();
                                                        }
                                                    })
                                                })
                                            }));
                                            resolve1();

                                        }).catch ((e) => {
                                            resolve1();
                                        });
                                    }
                                } else {
                                    let filteredAttach = mail.attachments.filter((elem2) => elem2.path.includes(elem.filter));

                                    if (filteredAttach.length > 0) {
                                        template = await writeMail(filteredAttach[0].path, undefined, mail.date, template, elem.id)
                                        resolve1();
                                    }
                                }
                            }
                        } else {
                            resolve1();
                        }
                    })
                }))

            }).start();
    });
}

async function makePrices(template) {
    return new Promise(async resolve => {
        console.log("Запись прайсов...");
        for (let i = 0; i < template.length; i++) {

            /** @namespace template.in_use */
            if (template[i].source !== null && template[i].source.length > 0) {

                let main_file = '';

                if (template[i].source.includes('%')) {
                    main_file = await findFile(template[i].source)
                } else {
                    main_file = template[i].source
                }

                let addQuery = {
                    text: `SELECT additional_tables.name
                           FROM rules_tables
                                  LEFT JOIN additional_tables ON rules_tables.add_table = additional_tables.id
                           WHERE convert_rule = $1`,
                    values: [template[i].id]
                };
                let add_tables = (await clientPg.query(addQuery)).rows;

                await convertFiles(main_file, template[i], add_tables, template[i].outer_name, template[i])

            } else {
                console.log('Прайс ' + template[i].outer_name + " не найден.");
            }
        }
        console.log("Запись прайсов завершена.");
        resolve();
    });
}


async function findFile(path) {
    return new Promise(async (resolve) => {
        path = path.replace(/%/g, '');
        let bb = await readdir(path.substring(0, path.indexOf('\\')), function (err, items) {
            items = items.filter((elem) => {
                return elem.includes(path.substring(path.indexOf('\\') + 1, path.length))
            });
            resolve(path.substring(0, path.indexOf('\\') + 1) + items[0])
        });
        resolve(bb)
    })
}

function convertTxtToArray(path) {
    return new Promise((resolve) => {

        fs.readFile(path, null, (err, data) => {

            let file = data.toString();
            let object = [];
            object.push({
                data: file.split('\r\n')
            });


            for (let i = 0; i < object[0].data.length; i++) {
                object[0].data[i] = object[0].data[i].split(';')
            }
            object[0].data.length = object[0].data.length - 1;
            resolve(object)
        })
    })
}

function convertXlsxToArray(path) {
    return new Promise((resolve) => {
        xlsx.parseFileAsync(path, {}, (parsedObject) => {
            if (parsedObject) {

                resolve(parsedObject)
            }
        })
    })
}


function buildXlsx(newExcel, resultName) {
    return new Promise(async resolve => {

        if (resultName === 'УАЗ ЦС') {
            let text = `truncate table uaz1_add0;
            INSERT INTO uaz1_add0 VALUES`;
            for (let i = 0; i < newExcel.length; i++) {
                text += '(';
                for (let j = 0; j < newExcel[i].length; j++) {
                    if (newExcel[i][j] === undefined || newExcel[i][j] === null) {
                        text += '' + null + ','
                    } else if (typeof newExcel[i][j] === 'object') {
                        text += '\'' + newExcel[i][j].v + '\','
                    } else if (typeof newExcel[i][j] === 'string') {
                        text += '\'' + newExcel[i][j] + '\','
                    } else {
                        text += '' + newExcel[i][j] + ','
                    }
                }
                text = text.substring(0, text.length-1) + '),';
            }
            text = text.substring(0, text.length-1) + ';';
            console.log(text)

            clientPg.query(text)
                .then(()=> {
                    xlsx.buildAsync([{
                        name: "price",
                        data: newExcel
                    }], {}, function (error, xlsBuffer) {
                        if (!error) {
                            fs.writeFileSync(fs.realpathSync('./ready') + '/' + resultName + '.xlsx', xlsBuffer);
                            let ObjectXls = xlsxConverter.readFile(fs.realpathSync('./ready') + '/' + resultName + '.xlsx');
                            xlsxConverter.writeFile(ObjectXls, fs.realpathSync('./ready') + '/' + resultName + '.xlsx', {compression: true})
                            console.log('Прайс ' + resultName + ' записан');
                            resolve()
                        } else {
                            console.log('Ошибка записи ' + error);
                            resolve()
                        }
                    })
                })
        } else {

            xlsx.buildAsync([{
                name: "price",
                data: newExcel
            }], {}, function (error, xlsBuffer) {
                if (!error) {
                    fs.writeFileSync(fs.realpathSync('./ready') + '/' + resultName + '.xlsx', xlsBuffer);
                    let ObjectXls = xlsxConverter.readFile(fs.realpathSync('./ready') + '/' + resultName + '.xlsx');
                    xlsxConverter.writeFile(ObjectXls, fs.realpathSync('./ready') + '/' + resultName + '.xlsx', {compression: true})
                    console.log('Прайс ' + resultName + ' записан');
                    resolve()
                } else {
                    console.log('Ошибка записи ' + error);
                    resolve()
                }
            })
        }
    })
}


async function convertFiles(path, template, tables, resultName) {
    return new Promise(async resolve => {
        path = path.toLowerCase();
        if (path.substring(path.length - 3, path.length) === 'txt') {

            let object = await convertTxtToArray(path);
            let ee = await modifyExcel(object, template);
            await buildXlsx(ee, resultName);
            resolve();


        } else if ((path.substring(path.length - 3, path.length) === 'xls') || (path.substring(path.length - 3, path.length).toLowerCase() === 'csv') || path.substring(path.length - 3, path.length) === 'lsx') {

            let ObjectXls = xlsxConverter.readFile(path);

            xlsxConverter.writeFile(ObjectXls, './temp.xlsx');
            let realPath = fs.realpathSync('./temp.xlsx');
            let object = await convertXlsxToArray(realPath);

            if (object.length > 1 && resultName === 'УАЗ ЦС') {
                for (let i = 0; i < object.length; i++) {

                    let list = object[i];
                    //red для 0 листа удаляется 4 и 5 колонка, для остальных только 4.
                    //red сделано для Уаза, потому что корявый прайс по каждому листу
                    //red не уверен, есть ли смысл добавлять какие то параметры на это или оставить как есть

                    for (let j = 0; j < list.data.length; j++) {

                        let elem = list.data[j];
                        if (i === 0) {
                            elem.splice(4, 2);
                            if (elem[4] === undefined || elem[1] === 'Каталожный номер') {
                                list.data.splice(list.data.indexOf(elem), 1);
                                j--
                            }
                        } else {
                            elem.splice(4, 1);
                            //red склеиваем листы
                            if (elem[4] !== undefined && elem[1] !== 'Каталожный номер') {
                                object[0].data.push(elem)
                            }
                        }

                    }


                    //red конец
                }
            }

            let arrayOfTables = [];
            await Promise.all(tables.map(async (table) => {
                arrayOfTables.push(table.name)
            }));
            await buildXlsx(await modifyExcel(object, template, arrayOfTables, resultName), resultName);
            resolve();
        }
    })
}

async function modifyExcel(parsedObject, template, arrayOfTables, resultName) {
    return new Promise(async (resolve) => {

            //Объединяем таблицы так, как это описано в таблице шаблонов
            if (template.unions !== null) {
                /** @namespace template.unions */
                for (let j = 0; j < template.unions.length; j++) {

                    let templateElement = template.unions[j];


                    let tableNumber = templateElement.substring(templateElement.indexOf('T') + 1, templateElement.indexOf(':'));
                    //если объединяем файл с файлом

                    let accord = templateElement.substring(templateElement.indexOf(':') + 1, templateElement.indexOf('|'));
                    let newColumn = templateElement.substring(templateElement.indexOf('|') + 1, templateElement.length);
                    //A-0 B-1 C-2 ...
                    let accordLeft = accord.substring(0, accord.indexOf('='));
                    let accordRight = accord.substring(accord.indexOf('=') + 1, accord.length).toLowerCase();
                    accordLeft = ('ABCDEFGHIJKLMNOPQRSTUVWXYZ').indexOf(accordLeft);

                    let newColumns = newColumn.split('+');

                    let newColumnLeft = [];
                    let newColumnRight = [];

                    for (let i = 0; i < newColumns.length; i++) {
                        newColumnLeft.push(('ABCDEFGHIJKLMNOPQRSTUVWXYZ').indexOf(newColumns[i].substring(0, newColumns[i].indexOf('='))));
                        newColumnRight.push(newColumns[i].substring(newColumns[i].indexOf('=') + 1, newColumns[i].length).toLowerCase());
                    }
                    //получили из базы массив
                    let filtered = await clientPg.query('Select ' + newColumnRight.join(', ') + ', ' + accordRight + ' from ' + arrayOfTables[tableNumber]);

                    mergeArrays(parsedObject[0].data, filtered.rows, accordLeft, accordRight, newColumnLeft, newColumnRight)


                }
            }

            //filtering
            for (let j = 0; j < template.filters.length; j++) {

                /** @namespace template.filters */
                let templateElement = template.filters[j];
                if (templateElement !== "") {
                    if (templateElement.length > 0) {
                        //тут функции фильтров
                        if (templateElement.includes('ВКЛЮЧАЕТ')) {

                            let filter = templateElement.substring(templateElement.indexOf('ВКЛЮЧАЕТ(') + ('ВКЛЮЧАЕТ(').length, templateElement.indexOf(')'));
                            //сама фильтрация, тут все просто
                            for (let k = 1; k < parsedObject[0].data.length; k++) {
                                if (!(('' + parsedObject[0].data[k][j]).toLowerCase().includes(filter.toLowerCase()))) {
                                    parsedObject[0].data.splice(k, 1);
                                    k--
                                }
                            }
                        }

                        if (template.filters[j].includes('ВКЛЮЧАЕТСИНДЕКСОМ')) {

                            let templateElement = template.filters[j];

                            let filter = templateElement.substring(templateElement.indexOf('ВКЛЮЧАЕТСИНДЕКСОМ(') + ('ВКЛЮЧАЕТСИНДЕКСОМ(').length, templateElement.indexOf(';'));

                            let index = templateElement.substring(templateElement.indexOf(';') + (';').length, templateElement.indexOf(')'));

                            for (let k = 1; k < parsedObject[0].data.length; k++) {


                                if (!(('' + parsedObject[0].data[k][j]).toLowerCase()[index] === filter.toLowerCase())) {
                                    parsedObject[0].data.splice(k, 1);
                                    k--
                                }
                            }
                        }

                        if (template.filters[j].includes('ИСКЛЮЧАЕТСИНДЕКСОМ')) {

                            let templateElement = template.filters[j];

                            let filter = templateElement.substring(templateElement.indexOf('ИСКЛЮЧАЕТСИНДЕКСОМ(') + ('ИСКЛЮЧАЕТСИНДЕКСОМ(').length, templateElement.indexOf(';'));

                            let index = templateElement.substring(templateElement.indexOf(';') + (';').length, templateElement.indexOf(')'));

                            for (let k = 1; k < parsedObject[0].data.length; k++) {

                                if (('' + parsedObject[0].data[k][j]).toLowerCase()[index] === filter.toLowerCase()) {
                                    parsedObject[0].data.splice(k, 1);
                                    k--
                                }
                            }
                        }

                        if (template.filters[j].includes('ИСКЛЮЧАЕТ')) {

                            let templateElement = template.filters[j];

                            let filter = templateElement.substring(templateElement.indexOf('ИСКЛЮЧАЕТ(') + ('ИСКЛЮЧАЕТ(').length, templateElement.indexOf(')'));

                            for (let k = 1; k < parsedObject[0].data.length; k++) {

                                if ((('' + parsedObject[0].data[k][j]).toLowerCase().includes(filter.toLowerCase()))) {
                                    parsedObject[0].data.splice(k, 1);
                                    k--
                                }
                            }

                        }

                        if (template.filters[j].includes('ЗАПОЛНЕНО')) {
                            for (let k = 1; k < parsedObject[0].data.length; k++) {
                                if (parsedObject[0].data[k][j] === undefined || parsedObject[0].data[k][j] === null || parsedObject[0].data[k][j].length === 0) {
                                    parsedObject[0].data.splice(k, 1);
                                    k--
                                }
                            }
                        }

                        if (template.filters[j].includes('ЗАПОЛНЕНОЧИСЛО')) {
                            for (let k = 1; k < parsedObject[0].data.length; k++) {
                                if (parsedObject[0].data[k][j] === undefined || parsedObject[0].data[k][j] === null || parsedObject[0].data[k][j].length === 0 || typeof (parsedObject[0].data[k][j]) !== 'number') {
                                    parsedObject[0].data.splice(k, 1);
                                    k--
                                }
                            }
                        }
                    }

                }
            }

            let newExcel = [];
            //parsing and use formulas

            await Promise.all(parsedObject[0].data.map(async (oldElem) => {

                if (parsedObject[0].data[0] !== oldElem) {

                    let elem = [];

                    for (let i = 0; i < template.columns.length; i++) {
                        /** @namespace template.formulas */
                        let formule = template.formulas[i];
                        if (formule === undefined){
                            continue;
                        }
                        let format = '';
                        //Формат
                        if (formule.includes('::')) {
                            format = formule.substring(formule.indexOf('::') + ('::').length, formule.length);
                            formule = formule.substring(0, formule.indexOf('::'))
                        }

                        //тут мы преобразовываем формулу в js. самое сложное
                        let formula = await formula_lib.makeFormula(('' + formule).substring(0, formule.length), oldElem);
                        let ff = formula;
                        try {

                            formula = eval((formula.replace(/\r/g, '').replace(/\n/g, '')));
                        } catch (e) {
                            console.log(ff);
                        }
                        if (formula === 2/0){
                            console.log(ff)
                        }


                        if (resultName === 'CHERY' && typeof (formula) === "string") {
                            formula = iconv.decode(iconv.encode(new Buffer(formula), "cp1252"), "cp1251")
                        }

                        if (typeof (formula) === "number") {
                            formula = parseFloat(formula.toFixed(2))
                        }
                        if (parseInt(formula) == formula) {
                            formula = parseInt(formula)
                        }
                        if (format !== '') {
                            formula = {v: formula, z: format}
                        }

                        elem.push(formula)
                    }
                    newExcel.push(elem)
                }
            }));
            resolve(newExcel)
        }
    )
}

function gmMakeRequest(template) {
    return new Promise((resolve, reject) => {
        console.log("Скачивание прайса gm...");
        let cookiejar = req.jar();
        let chunks = [];

        clientPg.query({
            text: 'SELECT * FROM SETTINGS WHERE folder = $1',
            values: ['Портал']
        })
            .then(result => {

                req.post('https://gm-system.ru/logon.aspx?ReturnUrl=%2finv310t.aspx', {
                    form: {
                        __VIEWSTATE: '/wEPDwUKMTQ4NDQ4Mzg5OA9kFgICAQ9kFgICBQ8WBB4IZGlzYWJsZWRkHgdWaXNpYmxlZ2RkJYnr25q2Le7GCkMzeAxPtQ==',
                        __EVENTVALIDATION: '/wEdAATPNFOBfaFoumntiQHVWjTWY3plgk0YBAefRz3MyBlTcHY2+Mc6SrnAqio3oCKbxYa/Ddi58i/dsQ6aLnYJIUBmP9QJB9H8R/JbGT6I/xJqEQ==',
                        txtUserName: result.rows.filter(row => row.name === 'Логин на портал')[0].param,
                        txtPassword: result.rows.filter(row => row.name === 'Пароль на портал')[0].param
                    }
                }).on('error', (err) => {
                    resolve();
                    console.log("Ошибка подключения к порталу GM: " + err)
                }).on('response', (response) => {
                    if (response.headers["set-cookie"] && response.headers["set-cookie"].length > 1) {
                        cookiejar.setCookie(response.headers["set-cookie"][0], 'https://gm-system.ru/inv310t.aspx');
                        cookiejar.setCookie(response.headers["set-cookie"][1], 'https://gm-system.ru/inv310t.aspx');
                        req.post('https://gm-system.ru/inv310t.aspx', {
                            form: {
                                __EVENTTARGET: 'ctl01',
                                __EVENTARGUMENT: '',
                                __VIEWSTATE: '/wEPDwULLTEzNjQ2MDIxNTAPZBYEZg9kFggCAQ8WAh4JaW5uZXJodG1sBT5HTSBTeXN0ZW0gLSDQodC+0YHRgtC+0Y/QvdC40LUg0YHQutC70LDQtNCwINC30LDQv9GH0LDRgdGC0LXQuWQCAw88KwAFAQMUKwACEBYEHgZJdGVtSUQFFlRvcDFfTWVudTEtbWVudUl0ZW0wMDAeCEl0ZW1UZXh0BQ7QodC40YHRgtC10LzQsBQrAAIQFgYfAQUqVG9wMV9NZW51MS1tZW51SXRlbTAwMC1zdWJNZW51LW1lbnVJdGVtMDAxHwIFF9Ch0LzQtdC90LAg0L/QsNGA0L7Qu9GPHgdJdGVtVVJMBQ9jaGFuZ2VwYXNzLmFzcHhkZBAWBh8BBSpUb3AxX01lbnUxLW1lbnVJdGVtMDAwLXN1Yk1lbnUtbWVudUl0ZW0wMDIfAgUK0JLRi9GF0L7QtB8DBQlleGl0LmFzcHhkZGQQFgQfAQUWVG9wMV9NZW51MS1tZW51SXRlbTAwMR8CBR3QodC60LvQsNC0INC30LDQv9GH0LDRgdGC0LXQuRQrAAQQFgYfAQUqVG9wMV9NZW51MS1tZW51SXRlbTAwMS1zdWJNZW51LW1lbnVJdGVtMDAwHwIFMtCh0L7RgdGC0L7Rj9C90LjQtSDRgdC60LvQsNC00LAg0LfQsNC/0YfQsNGB0YLQtdC5HwMFDGludjMxMHQuYXNweGRkEBYGHwEFKlRvcDFfTWVudTEtbWVudUl0ZW0wMDEtc3ViTWVudS1tZW51SXRlbTAwMR8CBSHQntGC0LvQvtC20LXQvdC90YvQtSDQt9Cw0LrQsNC30YsfAwUMb3JwMTQwdC5hc3B4ZGQQFgYfAQUqVG9wMV9NZW51MS1tZW51SXRlbTAwMS1zdWJNZW51LW1lbnVJdGVtMDAyHwIFG9Ch0YLQsNGC0YPRgSDQt9Cw0LrQsNC30L7Qsh8DBQxzdG0xMTB0LmFzcHhkZBAWBh8BBSpUb3AxX01lbnUxLW1lbnVJdGVtMDAxLXN1Yk1lbnUtbWVudUl0ZW0wMDMfAgUd0JfQsNC60LDQtyDQt9Cw0L/Rh9Cw0YHRgtC10LkfAwULb3JwMTEwLmFzcHhkZGRkAgUPFgIfAAUq0JfQtNGA0LDQstGB0YLQstGD0LnRgtC1IFN2ZXRsYW5hIEtvc2htYXIhZAIHDxYCHgdWaXNpYmxlaGQCAg9kFgJmD2QWAgIHD2QWAmYPFgIfAAVi0J7QsdC90L7QstC70LXQvdC40LUgREFUOiAxOC4xMi4yMDE1IDA0OjIwOjQzPGJyPtCe0LHQvdC+0LLQu9C10L3QuNC1IFNORzogMjMuMDEuMjAxOSAxMzoyODo1OTxicj5kZDeZ0nCJ7JYHC1BgaScT0+E=',
                                __VIEWSTATEGENERATOR: 'ACCA6985',
                                __EVENTVALIDATION: '/wEdAAWkZZu4SpMvIFRnXbSzYtL1nS6zCR2bqUXJuevSr6A3NiXIFWL+wv45SHU62q4rLobxTrg7s/eG70UIAOod3OxqcWtaTiCzWpv2jfgTJfZJLmn4OSO2uJ+O7zNnpLgP+WU=',
                                tMask: '',
                                hdnMask: ''
                            },
                            jar: cookiejar
                        }).on('error', (err) => {
                            resolve();
                            console.log("Ошибка подключения к порталу GM: " + err)
                        }).on('data', (data) => {
                            chunks.push(data)
                        }).once('end', async () => {
                            let buffer = Buffer.concat(chunks);

                            let file = iconv.decode(buffer, 'cp-1251');
                            fs.writeFileSync('./attachments/gm-stock.txt', file);
                            await Promise.all(template.map(async (elem) => {
                                /** @namespace elem.outer_name */
                                if (elem.outer_name === 'GM') {
                                    writeMail('./attachments/gm-stock.txt', undefined, new Date(), template, elem.id);
                                    resolve();
                                }
                            }));
                            resolve();
                        })
                    } else {
                        console.log('Необходимо обновить пароль к порталу GM!');
                        resolve();
                    }
                })
            })
    })

}

function convertDBQueryToArray(query) {
    return new Promise(resolve => {
        clientPg.query(query)
            .then(result => {
                resolve(result.rows);
            }, error => {
                console.log(error)
            })
    })
}

main();