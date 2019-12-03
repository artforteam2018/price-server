let CBCurrencies;

module.exports.makeFormula = function makeFormula(str, elem, currency) {
    return new Promise(async resolve => {

        CBCurrencies = currency;

        str = str.replace(/\b(?:\W|^|)([A-Z])\b([^']|$)(?:\W|$|)/g, function (str) {
            return str.replace(/[A-Z]/g, function (str) {
                return 'elem[' + 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.indexOf(str) + ']'
            })
        });

        str = str.replace(/=/g, '===');
        str = str.replace(/<>/g, '!==');
        for (let k = 0; k < elem.length; k++) {

            if (typeof elem[k] === 'string') {
                //let elemStr = elem[k].replace(/"/g, "`");
                let elemStr = elem[k].replace(/"/g, "");
                elemStr = elemStr.replace(/\(/g, ' ');
                elemStr = elemStr.replace(/\)/g, ' ');
                if (str.includes('elem[') && typeof elemStr === 'number' ||
                    parseInt(parseFloat(elemStr.replace(/,/g, '.'))) == parseInt(elemStr.replace(/,/g, '.')) && parseFloat(elemStr.replace(/,/g, '.')) == elemStr.replace(/,/g, '.')) {

                    str = str.split('elem[' + k + ']').join(elemStr.replace(/,/g, '.'))
                } else {
                    str = str.split('elem[' + k + ']').join('`' + elemStr + '`')
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

        //Валюта
        str = str.replace(/КУРС\((\w*)\)/gi, (a,curr) => CBCurrencies[curr].Value)

        //Замена
        str = str.replace(/ЗАМЕНА\((.*?);(.*?);(.*?)\)/gi, (a, def, from, to) => def.replace(new RegExp(from,'gi'), to));

        str = str.replace(/ЭТОЧИСЛО\((.*?)\)/gi, (a, def) => parseFloat(def.replace(new RegExp(',','gi'), '.').replace(/\`/g, '')));


        //те что снизу сделаны давно и их можно (и нужно) заменить такими же как сверху. они производительнее
        //найдешь время - перепиши

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
