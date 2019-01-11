const xlsx = require('async-xlsx');//быстрое чтение и запись экселя, возможно этот элемент и не нужен, но теперь уже лучше не трогать
const xlsxConverter = require('xlsx'); //нормальная либа экселя
const fs = require('fs'); //файлы
const util = require('util'); //промисы
const iconv = require('iconv-lite');
const {Client} = require('pg'); //работа с бд
const JSZip = require('jszip'); //работа с архивами zip
const readdir = util.promisify(fs.readdir); //чтобы асинк работал
const nodemailer = require('nodemailer'); //прослушка почты
const req = require('request');
const emlformat = require('eml-format'); //Для работы с eml
const notifier = require('mail-notifier');
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
    values: ['Почта для рассылки']
})
    .then(result => {
        const mailTransport = nodemailer.createTransport({
            host: result.rows.filter(row => row.name === 'Хостинг почты')[0].param,
            port: result.rows.filter(row => row.name === 'Порт почты')[0].param,
            secure: true,
            auth: {
                user: result.rows.filter(row => row.name === 'Имя пользователя')[0].param,
                pass: result.rows.filter(row => row.name === 'Пароль')[0].param
            }
        });
    })

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
            search: ['SEEN'],
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
                    imapCounter = e.replace(/\<\= \'\* /g, '').replace(/EXISTS\'/, '');
                    console.log("Найдено " + imapCounter + "писем.");
                }
            }
        };
        notify = notifier(imap);
    })

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

function ConnectBase() {
    return new Promise(function (resolve, reject) {

        let client = new Client({
            host: config.get('БазаДанныхСПрайсами.Хостинг'),
            port: config.get('БазаДанныхСПрайсами.Порт'),
            user: config.get('БазаДанныхСПрайсами.Пользователь'),
            password: config.get('БазаДанныхСПрайсами.Пароль'),
            database: config.get('БазаДанныхСПрайсами.ИмяБазыДанных')
        });
        client.connect()
            .then(() => resolve(client))
            .catch(() => {
                console.log('Ошибка подключения')
            })
    })
}


async function main() {
    let query = `SELECT id,
                        sender,
                        outer_name,
                        filter,
                        template,
                        source,
                        title_filter,
                        MAX(upl.date) AS last_date
                 FROM convert_rules
                        LEFT JOIN update_price_log AS upl on convert_rules.id = upl.convert_rule
                 GROUP BY id, title_filter, outer_name, filter, sender, template, source`;
    let template = await convertDBQueryToArray(query);

    //sendPrices( )

    // }, 5 * 60 * 1000);
    await mailListen(template)
    await gmMakeRequest();
    await makePrices()
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
        }
        let queryInsert = {
            text: `INSERT INTO update_price_log (date, convert_rule)
            VALUES ($1, $2)`,
            values: [date, id]
        }
        clientPg.query(queryUpdate)
            .then(()=>{
                clientPg.query(queryInsert)
                    .then(() => {
                        console.log('Найден новый прайс ' + template.filter(t => t.id === id)[0].outer_name + ' на ' + date.toLocaleDateString())
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
                await buildXlsx(__static + MAIN_PATH, template[0].data, 'MAINTEMPLATE', true)
                template = await convertXlsxToArray(MAIN_PATH);
                resolve();
            })
            .on('error', async (e) => {
                await buildXlsx(__static + MAIN_PATH, template[0].data, 'MAINTEMPLATE', true)
                template = await convertXlsxToArray(MAIN_PATH);
                console.log("Произошла ошибка при попытке подключения к почте. Описание ошибки: \n" + e);
                resolve();
            })
            .on('mail', function (mail) {


                template.map(async (elem) => {

                    if (mail.attachments !== undefined && elem.sender !== null
                        && elem.sender.toLowerCase() === mail.from[0].address.toLowerCase() && (elem.last_date === null ? true : elem.last_date < Date.parse(mail.date))) {

                        mail.attachments.forEach(attach => {
                            fs.writeFileSync('./attachments/' + attach.fileName, attach.content)
                            attach.path = './attachments/' + attach.fileName
                        })

                        if (elem.title_filter !== null) {
                            if (!mail.subject.includes(elem.title_filter)) {
                                return;
                            }
                        }
                        if (elem.filter === null) {
                            let mailPath = mail.attachments["0"].path
                            if (mailPath.substring(mailPath.lastIndexOf('.') + 1, mailPath.length) === 'eml') {
                                let eml = fs.readFileSync(mailPath, "utf-8");
                                emlformat.read(eml, async (error, data) => {

                                    if (error) return console.log(error);
                                    let writePath = mailPath.substring(0, mailPath.lastIndexOf('\\') + 1) + "UAZ-EMAIL.xlsx";
                                    template = await writeMail(writePath, data.attachments["0"].data, mail.date, template, template.indexOf(elem));

                                });
                            } else {
                                if (mailPath.substring(mailPath.lastIndexOf('\\') + 1, mailPath.lastIndexOf('.')) === 'price') {

                                    let buffer = fs.readFileSync(mailPath);
                                    let newName = mailPath.substring(0, mailPath.lastIndexOf('\\') + 1) + elem.outer_name + mailPath.substring(mailPath.lastIndexOf('.'), mailPath.length)
                                    template = await writeMail(newName, buffer, mail.date, template, template.indexOf(elem))

                                } else {
                                    template = await writeMail(mailPath, undefined, mail.date, template, elem.id)
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

                                    let data = fs.readFileSync(filteredAttach[0].path)

                                    JSZip.loadAsync(data).then(function (zip) {
                                        let files = Object.keys(zip.files);
                                        if (files.length > 0) {

                                            if (!fs.existsSync(folder)) {
                                                fs.mkdirSync(folder);
                                            }
                                        }
                                        files.forEach((file) => {
                                            zip.files[file].async('uint8array').then(async (uint8array) => {
                                                if (file.includes(elemFilter)) {
                                                    template = await writeMail(folder + '\\' + file, uint8array, mail.date, template, elem.id)
                                                }
                                            })

                                        })

                                    });
                                }
                            } else {
                                let filteredAttach = mail.attachments.filter((elem2) => elem2.path.includes(elem.filter));

                                if (filteredAttach.length > 0) {
                                    template = await writeMail(filteredAttach[0].path, undefined, mail.date, template, elem.id)
                                }
                            }
                        }
                    }
                })

            }).start();
    });
}

async function sendPrices() {
    console.log("Рассылка прайсов...");
    let ObjectXls = xlsxConverter.readFile(config.get('Основное.ПолучателиПрайсов'));
    xlsxConverter.writeFile(ObjectXls, __static + '/temp.xlsx');
    let object = await convertXlsxToArray('/temp.xlsx');
    let readyFolder = config.get('Основное.ПодпапкаСГотовымиПрайсами')

    await Promise.all(object[0].data.map((elem) => {


        if (elem[4] === undefined) {
            elem[4] = '' + new Date();
        } else {
            if ((Date.now() - Date.parse(elem[4])) / 1000 / 60 > elem[3]) {
                let attach = []
                elem[1].replace(/ /g, '').split(',').map((elem2) => {
                    attach.push(
                        {
                            filename: elem2 + '.xlsx',
                            content: fs.createReadStream(__static + readyFolder + '\\' + elem2 + '.xlsx')
                        }
                    )
                });

                let mailOptions = {
                    from: config.get('ПочтаДляРассылки.ИмяПользователя'), // sender address
                    to: elem[0], // list of receivers
                    subject: 'Прайсы ' + elem[1], // Subject line
                    text: 'Прайсы ' + elem[1], // plain text body
                    attachments: attach
                };
                mailTransport.sendMail(mailOptions, (error, info) => {
                    if (error) {
                        return console.log(error);
                    }
                });
                elem[4] = '' + new Date()
            }

        }
        ;
    }));
    await buildXlsx(config.get('Основное.ПолучателиПрайсов'), object[0].data, '', true)
    console.log("Рассылка прайсов завершена.");
}

async function makePrices() {
    return new Promise(resolve => {
        console.log("Запись прайсов...");
        setTimeout(async () => {
            let template = await convertXlsxToArray(MAIN_PATH);
            for (let i = 1; i < template[0].data.length; i++) {

                if (template[0].data[i][0] !== undefined) {

                    let main_file = '';

                    if (template[0].data[i][0].includes('%')) {
                        main_file = await findFile(template[0].data[i][0])
                    } else {
                        main_file = template[0].data[i][0]
                    }

                    let template_file = template[0].data[i][1];
                    let add_tables = [];

                    //разбиваем доп таблицы на массив, потом пригодится
                    if (template[0].data[i].length > 2) {
                        let tablesStr = template[0].data[i][2];

                        if (tablesStr !== undefined) {
                            while (tablesStr.includes(';')) {
                                add_tables.push(tablesStr.substring(0, tablesStr.indexOf(';')));
                                tablesStr = tablesStr.substring(tablesStr.indexOf(';') + 1, tablesStr.length)

                            }
                        }
                    }

                    await convertFiles(main_file, template_file, add_tables, template[0].data[i][5], template[0].data[i])

                } else {
                    console.log('Прайс ' + template[0].data[i][5] + " не найден.");
                }
            }
            console.log("Запись прайсов завершена.");
            resolve();
        }, 200);
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
        let iconv = require('iconv-lite');

        fs.readFile(__static + path, null, (err, data) => {

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

        xlsx.parseFileAsync(__static + path, {}, (parsedObject) => {
            if (parsedObject) {

                resolve(parsedObject)

            }
        })

    })


}


function buildXlsx(path, newExcel, resultName, rewrite = false) {
    return new Promise(async resolve => {
        // let sheet = xlsxConverter.utils.json_to_sheet(newExcel)
        // let wb = new xlsxConverter.utils.book_new();
        // xlsxConverter.utils.book_append_sheet(wb, sheet, "1");
        // xlsxConverter.writeFile(wb, path);
        //
        // resolve();
        xlsx.buildAsync([{
            name: "price",
            data: newExcel
        }], {}, function (error, xlsBuffer) {
            if (!error) {
                if (rewrite) {
                    fs.writeFileSync(path, xlsBuffer)
                    xlsBuffer = null;
                    newExcel = null;
                    resolve()
                } else {
                    let isbad = path.lastIndexOf(config.get('Основное.ПодпапкаСГотовымиПрайсами'));
                    let paths = path.lastIndexOf(config.get('Основное.ПодпапкаСГотовымиПрайсами')) === -1 ? path.lastIndexOf('\\') : path.lastIndexOf(config.get('Основное.ПодпапкаСГотовымиПрайсами')) + config.get('Основное.ПодпапкаСГотовымиПрайсами').length;
                    let resName = path.substring(0, paths);
                    if (isbad === -1) resName += '\\static' + config.get('Основное.ПодпапкаСГотовымиПрайсами')

                    if (path.includes(config.get('Основное.ПодпапкаСГотовымиПрайсами')) && !path.includes(__static)) resName = __static + resName;
                    resName += resultName;
                    fs.writeFileSync(resName + '.xlsx', xlsBuffer)
                    console.log('Прайс ' + resultName + ' записан')
                    resolve()
                }
            } else {
                console.log('Ошибка записи ' + error);
                resolve()
            }
        });
    })
}

async function convertFiles(path, tPath, tables, resultName, mainfile) {
    return new Promise(async resolve => {
        let filename = path.split(config.get('Основное.ПодпапкаСВложениями')).join(config.get('Основное.ПодпапкаСГотовымиПрайсами'));
        path = path.toLowerCase();
        if (path.substring(path.length - 3, path.length) === 'txt') {

            let object = await convertTxtToArray(path);
            let template = await convertXlsxToArray(config.get('Основное.ПодпапкаСШаблонами') + '/' + tPath);
            let ee = await modifyExcel(object, template)
            await buildXlsx(filename, ee, resultName)
            resolve();


        } else if ((path.substring(path.length - 3, path.length) === 'xls') || (path.substring(path.length - 3, path.length).toLowerCase() === 'csv') || path.substring(path.length - 3, path.length) === 'lsx') {

            let ObjectXls = xlsxConverter.readFile(path);
            xlsxConverter.writeFile(ObjectXls, __static + '/temp.xlsx');
            let object = await convertXlsxToArray('/temp.xlsx');
            let template = await convertXlsxToArray(config.get('Основное.ПодпапкаСШаблонами') + '/' + tPath);
            //todo lists
            if (object.length > 1 && resultName === 'УАЗ ЦС') {
                for (let i = 0; i < object.length; i++) {

                    let list = object[i];
                    //red для 0 листа удаляется 4 и 5 колонка, для остальных только 4.
                    //red сделано для Уаза, потому что корявый прайс по каждому листу
                    //red не уверен, есть ли смысл добавлять какие то параметры на это или оставить как есть

                    for (let j = 0; j < list.data.length; j++) {

                        let elem = list.data[j]
                        if (i === 0) {
                            elem.splice(4, 2)
                            if (elem[4] === undefined || elem[1] === 'Каталожный номер') {
                                list.data.splice(list.data.indexOf(elem), 1)
                                j--
                            }
                        } else {
                            elem.splice(4, 1)
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
                if (table.substring(table.indexOf('.') + 1) === 'DATABASE') {
                    let baseName = table.substring(0, table.lastIndexOf('.'))
                    let client = await ConnectBase();
                    arrayOfTables.push(['DB', client, baseName])
                } else {
                    arrayOfTables.push(['FILE', await convertXlsxToArray(table)])
                }
            }));
            await buildXlsx(filename, await modifyExcel(object, template, arrayOfTables, resultName), resultName)
            resolve();
        }
    })
}

async function modifyExcel(parsedObject, parsedObjectTemplate, arrayOfTables, resultName) {
    return new Promise(async (resolve) => {
        let templateStr = {
            rescol: 1,
            filters: 3,
            formulas: 5,
            joining: 7
        };

        let arrayOfCells = makeCells();
        //Объединяем таблицы так, как это описано в таблице шаблонов
        if (parsedObjectTemplate[0].data[templateStr.joining] !== undefined) {
            for (let j = 0; j < parsedObjectTemplate[0].data[templateStr.joining].length; j++) {

                let templateElement = parsedObjectTemplate[0].data[templateStr.joining][j];


                let tableNumber = templateElement.substring(templateElement.indexOf('T') + 1, templateElement.indexOf(':'));
                //если объединяем файл с файлом
                if (arrayOfTables[tableNumber][0] === 'FILE') {
                    //это разборка шаблона на элемент фильтрации accord и на элемент который хотим вставить в таблицу newcolumn
                    let accord = templateElement.substring(templateElement.indexOf(':') + 1, templateElement.indexOf('|'));
                    let newColumn = templateElement.substring(templateElement.indexOf('|') + 1, templateElement.length);
                    //A-0 B-1 C-2 ...
                    let accordLeft = accord.substring(0, accord.indexOf('=') - 1);
                    let accordRight = accord.substring(accord.indexOf('=') + 1, accord.length - 1);

                    accordLeft = ('ABCDEFGHIJKLMNOPQRSTUVWXYZ').indexOf(accordLeft);
                    accordRight = ('ABCDEFGHIJKLMNOPQRSTUVWXYZ').indexOf(accordRight);

                    let newColumns = newColumn.split('+');

                    let newColumnLeft = [];
                    let newColumnRight = [];

                    for (let i = 0; i < newColumns.length; i++) {
                        newColumnLeft.push(('ABCDEFGHIJKLMNOPQRSTUVWXYZ').indexOf(newColumns[i].substring(0, newColumns[i].indexOf('=') - 1)));
                        newColumnRight.push(('ABCDEFGHIJKLMNOPQRSTUVWXYZ').indexOf(newColumns[i].substring(newColumns[i].indexOf('=') + 1, newColumns[i].length - 1)));
                    }

                    mergeArrays(parsedObject[0].data, arrayOfTables[tableNumber][1][0].data, accordLeft, accordRight, newColumnLeft, newColumnRight)

                    //если объединяем бд с файлом
                } else if (arrayOfTables[tableNumber][0] === 'DB') {
                    let accord = templateElement.substring(templateElement.indexOf(':') + 1, templateElement.indexOf('|'));
                    let newColumn = templateElement.substring(templateElement.indexOf('|') + 1, templateElement.length);
                    //A-0 B-1 C-2 ...
                    let accordLeft = accord.substring(0, accord.indexOf('=') - 1);
                    let accordRight = accord.substring(accord.indexOf('=') + 1, accord.length);
                    accordLeft = ('ABCDEFGHIJKLMNOPQRSTUVWXYZ').indexOf(accordLeft);

                    let newColumns = newColumn.split('+');

                    let newColumnLeft = [];
                    let newColumnRight = [];

                    for (let i = 0; i < newColumns.length; i++) {
                        newColumnLeft.push(('ABCDEFGHIJKLMNOPQRSTUVWXYZ').indexOf(newColumns[i].substring(0, newColumns[i].indexOf('=') - 1)));
                        newColumnRight.push(newColumns[i].substring(newColumns[i].indexOf('=') + 1, newColumns[i].length));
                    }
                    //получили из базы массив
                    let filtered = await arrayOfTables[tableNumber][1].query('Select ' + newColumnRight.join(', ') + ', ' + accordRight + ' from ' + arrayOfTables[tableNumber][2]);

                    mergeArrays(parsedObject[0].data, filtered.rows, accordLeft, accordRight, newColumnLeft, newColumnRight)

                }

            }
        }

        //filtering
        for (let j = 0; j < parsedObjectTemplate[0].data[templateStr.filters].length; j++) {

            let templateElement = parsedObjectTemplate[0].data[templateStr.filters][j];
            if (templateElement !== undefined) {
                if (templateElement.length > 0) {
                    //тут функции фильтров
                    if (templateElement.includes('ВКЛЮЧАЕТ')) {

                        let filter = templateElement.substring(templateElement.indexOf('ВКЛЮЧАЕТ{') + ('ВКЛЮЧАЕТ{').length, templateElement.indexOf('}'));
                        //сама фильтрация, тут все просто
                        for (let k = 1; k < parsedObject[0].data.length; k++) {
                            if (!(('' + parsedObject[0].data[k][j]).toLowerCase().includes(filter.toLowerCase()))) {
                                parsedObject[0].data.splice(k, 1);
                                k--
                            }
                        }
                    }

                    if (parsedObjectTemplate[0].data[templateStr.filters][j].includes('ВКЛЮЧАЕТСИНДЕКСОМ')) {

                        let templateElement = parsedObjectTemplate[0].data[templateStr.filters][j];

                        let filter = templateElement.substring(templateElement.indexOf('ВКЛЮЧАЕТСИНДЕКСОМ{') + ('ВКЛЮЧАЕТСИНДЕКСОМ{').length, templateElement.indexOf(','));

                        let index = templateElement.substring(templateElement.indexOf(',') + (',').length, templateElement.indexOf('}'));

                        for (let k = 1; k < parsedObject[0].data.length; k++) {


                            if (!(('' + parsedObject[0].data[k][j]).toLowerCase()[index] === filter.toLowerCase())) {
                                parsedObject[0].data.splice(k, 1);
                                k--
                            }
                        }
                    }

                    if (parsedObjectTemplate[0].data[templateStr.filters][j].includes('ИСКЛЮЧАЕТСИНДЕКСОМ')) {

                        let templateElement = parsedObjectTemplate[0].data[templateStr.filters][j];

                        let filter = templateElement.substring(templateElement.indexOf('ИСКЛЮЧАЕТСИНДЕКСОМ{') + ('ИСКЛЮЧАЕТСИНДЕКСОМ{').length, templateElement.indexOf(','));

                        let index = templateElement.substring(templateElement.indexOf(',') + (',').length, templateElement.indexOf('}'));

                        for (let k = 1; k < parsedObject[0].data.length; k++) {


                            if ((('' + parsedObject[0].data[k][j]).toLowerCase()[index] === filter.toLowerCase())) {
                                parsedObject[0].data.splice(k, 1);
                                k--
                            }
                        }
                    }

                    if (parsedObjectTemplate[0].data[templateStr.filters][j].includes('ИСКЛЮЧАЕТ')) {

                        let templateElement = parsedObjectTemplate[0].data[templateStr.filters][j];

                        let filter = templateElement.substring(templateElement.indexOf('ИСКЛЮЧАЕТ{') + ('ИСКЛЮЧАЕТ{').length, templateElement.indexOf('}'));

                        for (let k = 1; k < parsedObject[0].data.length; k++) {

                            if ((('' + parsedObject[0].data[k][j]).toLowerCase().includes(filter.toLowerCase()))) {
                                parsedObject[0].data.splice(k, 1);
                                k--
                            }
                        }

                    }

                    if (parsedObjectTemplate[0].data[templateStr.filters][j].includes('ЗАПОЛНЕНО')) {

                        for (let k = 1; k < parsedObject[0].data.length; k++) {

                            if (parsedObject[0].data[k][j] !== undefined && parsedObject[0].data[k][j] !== null) {
                                if (parsedObject[0].data[k][j].length === 0) {
                                    parsedObject[0].data.splice(k, 1);
                                    k--
                                }
                            } else {
                                parsedObject[0].data.splice(k, 1);
                                k--
                            }
                        }

                    }

                    if (parsedObjectTemplate[0].data[templateStr.filters][j].includes('ЗАПОЛНЕНОЧИСЛО')) {

                        for (let k = 1; k < parsedObject[0].data.length; k++) {

                            if (parsedObject[0].data[k][j] !== undefined && parsedObject[0].data[k][j] !== null && typeof (parsedObject[0].data[k][j]) === 'number') {
                                if (parsedObject[0].data[k][j].length === 0) {
                                    parsedObject[0].data.splice(k, 1);
                                    k--
                                }
                            } else {
                                parsedObject[0].data.splice(k, 1);
                                k--
                            }
                        }

                    }
                }
            }

        }

        let newExcel = [];
        newExcel.push(parsedObjectTemplate[0].data[templateStr.rescol]);
        //parsing and use formulas
        let count = 0;

        await Promise.all(parsedObject[0].data.map(async (oldElem) => {

            if (parsedObject[0].data[0] !== oldElem) {

                let elem = [];

                for (let i = 0; i < parsedObjectTemplate[0].data[templateStr.rescol].length; i++) {
                    let formule = parsedObjectTemplate[0].data[templateStr.formulas][i]
                    let format = '';
                    //Формат
                    if (formule.includes('::')) {
                        format = formule.substring(formule.indexOf('::') + ('::').length, formule.length)
                        formule = formule.substring(0, formule.indexOf('::'))
                    }

                    //тут мы преобразовываем формулу в js. самое сложное
                    let formula = await makeFormula(('' + formule).substring(0, formule.length), oldElem, arrayOfCells);
                    formula = eval((formula.replace(/\r/g, '').replace(/\n/g, '')));


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
    })
}

function makeFormula(str, elem, arrayOfCells) {
    return new Promise(async resolve => {

        //меняем функции на js

        arrayOfCells.forEach((elem) => {

            if (str.includes(elem[0])) {
                str = str.split(elem[0]).join('elem[' + elem[1] + ']')
            }
        });


        str = str.replace(/=/g, '===');
        str = str.replace(/<>/g, '!==');
        str = str.replace(/,/g, '.');
        for (let k = 0; k < elem.length; k++) {

            if (typeof elem[k] === 'string') {
                let elemStr = elem[k].replace(/"/g, '\\\"');
                elemStr = elemStr.replace(/\(/g, ' ');
                elemStr = elemStr.replace(/\)/g, ' ');
                if (str.includes('elem[') && typeof elemStr === 'number' ||
                    parseInt(parseFloat(elemStr.replace(/,/g, '.'))) == parseInt(elemStr.replace(/,/g, '.')) && parseFloat(elemStr.replace(/,/g, '.')) == elemStr.replace(/,/g, '.')) {

                    str = str.split('elem[' + k + ']').join(elemStr.replace(/,/g, '.'))
                } else {
                    str = str.split('elem[' + k + ']').join('"' + elemStr + '"')
                }
            } else {
                if (elem[k] === undefined) {
                    elem[k] = '"NothingType"'
                }
                str = str.split('elem[' + k + ']').join(elem[k])
            }
        }

        str = funcExc(str).then((answer) => {

            if (answer.length > 1) {
                str = answer[0].replace(/"\\"NothingType\\""/g, '');
            } else {
                str = answer.replace(/"\\"NothingType\\""/g, '');
            }

            resolve(str)
        });
    })
}

function makeCells() {
    let arrayOfDigits = '0123456789'.split('');
    let arrayOfLetters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
    let arrayOfCells = [];
    for (let i = 0; i < arrayOfLetters.length; i++) {
        arrayOfDigits.forEach((elem2) => {
            arrayOfCells.push(['' + arrayOfLetters[i] + elem2, i])
        })
    }

    return arrayOfCells
}

function funcExc(str) {
    return new Promise(async resolve => {

        let indexOfLast = 0;

        if (str.indexOf('ЕСЛИ') === 0) {
            str = str.replace('ЕСЛИ', 'if ');
            //само условие

            str = await substringFunc(str, '(', ';', false, false, true);

            //истинное

            str = await substringFunc(str, ';', ';');
            str = str.replace(';', ') {');

            //ложное

            str = await substringFunc(str, ';', ')');
            indexOfLast = str.indexOf(';');
            str = str.replace(';', '} else {');
            let indexOfLastAfterElse = await findEndIndex(str.substring(indexOfLast, str.length), ')', true) - 1;

            let strIndexed = str.substring(indexOfLast + indexOfLastAfterElse, str.length);
            let strIndexed2 = str.substring(0, indexOfLast + indexOfLastAfterElse);
            str = strIndexed2 + strIndexed.replace(')', '}')
        }

        //ceil(x) - возвращает ближайшее к Х большее целое;
        //floor(x) - возвращает ближайшее к Х меньшее целое;
        if (str.indexOf('ОКРУГЛВВЕРХ') === 0) {
            //исходное
            str = str.replace('ОКРУГЛВВЕРХ', 'Math.ceil');
            str = await substringFunc(str, '(', ';', false, false, true);
            //конечное
            str = await substringFunc(str, ';', ')', true);
            str = str.replace(/;/g, '');
            str = str.replace(/"/g, '')
        }

        if (str.indexOf('ОКРУГЛВНИЗ') === 0) {
            //исходное
            str = str.replace('ОКРУГЛВВЕРХ', 'Math.floor');
            str = await substringFunc(str, '(', ';', false, false, true);
            //конечное
            str = await substringFunc(str, ';', ')', true);
            str = str.replace(/;/g, '')
        }

        if (str.indexOf('ПОИСК') === 0) {
            str = str.replace('ПОИСК', '');
            let objectStr = await substringFunc(str, '(', ';', false, true);
            str = objectStr.beforeStr + objectStr.afterStr.replace(';', '') + ".indexOf(" + objectStr.str + ")";
        }

        if (str.indexOf('ЕЧИСЛО') === 0) {
            //исходное
            str = str.replace('ЕЧИСЛО', '-1 !==');
            str = await substringFunc(str, '(', ')')

        }

        resolve([str, indexOfLast])
    })
}

function findEndIndex(str, podSym, ifsSearch = false) {
    return new Promise(resolve => {
        //эта штука ищет конечный номер символа, который закрывает функцию. т.к. мы разбиваем функции на более мелкие
        let count = 1;
        let startIndex = 0;
        let finalIndex = 0;
        if (str.indexOf(podSym) < str.indexOf('(') || !~str.indexOf('(')) {
            finalIndex = str.indexOf(podSym)
        } else {
            if (ifsSearch) {
                while (count > 0) {

                    if (str.indexOf('(') < str.indexOf(')') && ~str.indexOf('(')) {
                        count++;
                        startIndex = str.indexOf('(') + 1
                    } else {
                        count--;
                        startIndex = str.indexOf(')') + 1
                    }
                    finalIndex += startIndex;
                    str = str.substring(startIndex, str.length)
                }
            }
            while (count > 1 || finalIndex === 0) {

                if (str.indexOf('(') < str.indexOf(')') && ~str.indexOf('(')) {
                    count++;
                    startIndex = str.indexOf('(') + 1
                } else {
                    count--;
                    startIndex = str.indexOf(')') + 1
                }
                finalIndex += startIndex;
                str = str.substring(startIndex, str.length)
            }
        }
        resolve(finalIndex)
    })
}

function substringFunc(str, podStr, podSym, deleteMe = false, giveBackObject = false, thisIsIf = false) {
    return new Promise(async resolve => {
        //тут много параметров, потому что пытался сделать универсально. будь аккуратен, если будешь трогать
        let returnStr = str;
        str = str.substring(str.indexOf(podStr) + 1, str.length);
        let endIndex = await findEndIndex(str, podSym);

        str = await funcExc(str.substring(0, endIndex));
        try {
            //если в if екселя есть функция, то тут считаем ее как обычную функцию, в js такого функционала нет
            if (thisIsIf && str[0].substring(0, 2) === 'if') {
                str[0] = eval(str[0])
            } else {
                str[0] = str[0]
            }

        } catch (e) {
            console.log(str[0]);
            str[0] = ''
        }
        str[0] = deleteMe ? '' : str[0];

        if (giveBackObject) {
            resolve({
                beforeStr: returnStr.substring(0, returnStr.indexOf(podStr) + 1),
                str: str[0],
                afterStr: returnStr.substring(endIndex + returnStr.indexOf(podStr) + 1, returnStr.length)
            })
        }
        resolve(returnStr.substring(0, returnStr.indexOf(podStr) + 1) + str[0] + returnStr.substring(endIndex + returnStr.indexOf(podStr) + 1, returnStr.length))
    })
}

function gmMakeRequest() {
    return new Promise((resolve, reject) => {
        console.log("Скачивание прайса gm...");
        let cookiejar = req.jar();
        let chunks = [];

        req.post('https://gm-system.ru/logon.aspx?ReturnUrl=%2finv310t.aspx', {
            form: {
                __VIEWSTATE: '/wEPDwUKMTQ4NDQ4Mzg5OA9kFgICAQ9kFgICBQ8WBB4IZGlzYWJsZWRkHgdWaXNpYmxlZ2RkJYnr25q2Le7GCkMzeAxPtQ==',
                __EVENTVALIDATION: '/wEdAATPNFOBfaFoumntiQHVWjTWY3plgk0YBAefRz3MyBlTcHY2+Mc6SrnAqio3oCKbxYa/Ddi58i/dsQ6aLnYJIUBmP9QJB9H8R/JbGT6I/xJqEQ==',
                txtUserName: config.get('GM.ЛогинНаПортал'),
                txtPassword: config.get('GM.ПарольНаПортал')
            }
        }).on('error', (err) => {
            resolve()
            console.log("Ошибка подключения к порталу GM: " + err)
        }).on('response', (response) => {
            if (response.headers["set-cookie"]) {
                cookiejar.setCookie(response.headers["set-cookie"][0], 'https://gm-system.ru/inv310t.aspx');
                cookiejar.setCookie(response.headers["set-cookie"][1], 'https://gm-system.ru/inv310t.aspx');
            }
            req.post('https://gm-system.ru/inv310t.aspx', {
                form: {
                    __EVENTTARGET: 'ctl01',
                    __EVENTARGUMENT: '',
                    __VIEWSTATE: '/wEPDwULLTEzNjQ2MDIxNTAPZBYEZg9kFggCAQ8WAh4JaW5uZXJodG1sBT5HTSBTeXN0ZW0gLSDQodC+0YHRgtC+0Y/QvdC40LUg0YHQutC70LDQtNCwINC30LDQv9GH0LDRgdGC0LXQuWQCAw88KwAFAQMUKwACEBYEHgZJdGVtSUQFFlRvcDFfTWVudTEtbWVudUl0ZW0wMDAeCEl0ZW1UZXh0BQ7QodC40YHRgtC10LzQsBQrAAIQFgYfAQUqVG9wMV9NZW51MS1tZW51SXRlbTAwMC1zdWJNZW51LW1lbnVJdGVtMDAxHwIFF9Ch0LzQtdC90LAg0L/QsNGA0L7Qu9GPHgdJdGVtVVJMBQ9jaGFuZ2VwYXNzLmFzcHhkZBAWBh8BBSpUb3AxX01lbnUxLW1lbnVJdGVtMDAwLXN1Yk1lbnUtbWVudUl0ZW0wMDIfAgUK0JLRi9GF0L7QtB8DBQlleGl0LmFzcHhkZGQQFgQfAQUWVG9wMV9NZW51MS1tZW51SXRlbTAwMR8CBR3QodC60LvQsNC0INC30LDQv9GH0LDRgdGC0LXQuRQrAAQQFgYfAQUqVG9wMV9NZW51MS1tZW51SXRlbTAwMS1zdWJNZW51LW1lbnVJdGVtMDAwHwIFMtCh0L7RgdGC0L7Rj9C90LjQtSDRgdC60LvQsNC00LAg0LfQsNC/0YfQsNGB0YLQtdC5HwMFDGludjMxMHQuYXNweGRkEBYGHwEFKlRvcDFfTWVudTEtbWVudUl0ZW0wMDEtc3ViTWVudS1tZW51SXRlbTAwMR8CBSHQntGC0LvQvtC20LXQvdC90YvQtSDQt9Cw0LrQsNC30YsfAwUMb3JwMTQwdC5hc3B4ZGQQFgYfAQUqVG9wMV9NZW51MS1tZW51SXRlbTAwMS1zdWJNZW51LW1lbnVJdGVtMDAyHwIFG9Ch0YLQsNGC0YPRgSDQt9Cw0LrQsNC30L7Qsh8DBQxzdG0xMTB0LmFzcHhkZBAWBh8BBSpUb3AxX01lbnUxLW1lbnVJdGVtMDAxLXN1Yk1lbnUtbWVudUl0ZW0wMDMfAgUd0JfQsNC60LDQtyDQt9Cw0L/Rh9Cw0YHRgtC10LkfAwULb3JwMTEwLmFzcHhkZGRkAgUPFgIfAAUq0JfQtNGA0LDQstGB0YLQstGD0LnRgtC1IFN2ZXRsYW5hIEtvc2htYXIhZAIHDxYCHgdWaXNpYmxlaGQCAg9kFgJmD2QWAgIHD2QWAmYPFgIfAAVi0J7QsdC90L7QstC70LXQvdC40LUgREFUOiAxOC4xMi4yMDE1IDA0OjIwOjQzPGJyPtCe0LHQvdC+0LLQu9C10L3QuNC1IFNORzogMTMuMTEuMjAxOCAxMzoyNzo0Mjxicj5kZOuFff9Q788OamS8YuIzhvA=',
                    __VIEWSTATEGENERATOR: 'ACCA6985',
                    __EVENTVALIDATION: '/wEdAAWNpNjlvVVSohfEXagCi5junS6zCR2bqUXJuevSr6A3NiXIFWL+wv45SHU62q4rLobxTrg7s/eG70UIAOod3OxqcWtaTiCzWpv2jfgTJfZJLl0276KKSn4egmlH8+40pAM=',
                    tMask: '',
                    hdnMask: ''
                },
                jar: cookiejar
            }).on('error', (err) => {
                resolve()
                console.log("Ошибка подключения к порталу GM: " + err)
            }).on('data', (data) => {
                chunks.push(data)
            }).once('end', async (response) => {
                let buffer = Buffer.concat(chunks);
                let file = iconv.decode(buffer, 'cp-1251');
                fs.writeFileSync(__static + config.get('Основное.ПодпапкаСВложениями') + 'gm-stock.txt', file)
                let template = await convertXlsxToArray(MAIN_PATH);
                await Promise.all(template[0].data.map(async (elem) => {
                    if (elem[5] === 'GM') {
                        elem[0] = config.get('Основное.ПодпапкаСВложениями') + 'gm-stock.txt';
                        elem[6] = Date.now();
                        console.log('Найден новый прайс ' + elem[5] + ' на ' + new Date(Date.now()).toLocaleDateString())
                        await buildXlsx(__static + MAIN_PATH, template[0].data, 'MAINTEMPLATE', true)
                        resolve(0);
                    }
                }));
                resolve(0);
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

module.exports.main = main;
