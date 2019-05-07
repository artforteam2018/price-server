let xlsx = require('async-xlsx');
let fs = require('fs');
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
let JSZip = require('jszip');
const {Client} = require('pg'); //работа с бд
const queries = require('./queries');
const clientPg = new Client({
    host: 'localhost',
    port: 5432,
    user: 'postgres',
    password: '88228228',
    database: 'II'
});
const readyFolder2 = fs.realpathSync('./ready2') + '/';
clientPg.connect(null, null);

function convertDBQueryToArray(query) {
    return new Promise(resolve => {
        clientPg.query(query)
            .then(result => {
                resolve(result.rows);
            })
            .catch((err) => {
                console.log(err)
            })
    })
}

async function sendPrices() {
    return new Promise(async resolve => {
        let readyFolder = fs.realpathSync('./ready') + '/';

        let receivers = await convertDBQueryToArray(queries.getTableQuery3);

        let receiverList = await (convertDBQueryToArray(queries.getReceiverQuery));

        await Promise.all(receivers.map(receive => {
            return new Promise(async resolve3 => {


                let frequency = 0;
                if (receive.frequency !== null) {
                    frequency = (receive.frequency.days ? receive.frequency.days * 60 * 1000 * 60 * 24 : 0) +
                        (receive.frequency.hours ? receive.frequency.hours * 60 * 1000 * 60 : 0) +
                        (receive.frequency.minutes ? receive.frequency.minutes * 60 * 1000 : 0)
                }

                if (receive.send_now) {
                    await new Promise(resolve1 => {
                        let query = {
                            text: queries.changeTableQuery,
                            values: [
                                receive.rule_name,
                                receive.sender,
                                receive.subscribe_to_update,
                                receive.result_name,
                                receive.in_use,
                                receive.intervals,
                                receive.frequency,
                                receive.title,
                                receive.region,
                                receive.groups,
                                receive.xls,
                                false,
                                receive.removed,
                                receive.id
                            ]
                        };
                        clientPg.query(query)
                            .then(async () => {
                                await createAndSendMail(receive, readyFolder, receiverList);
                                resolve1();
                            })
                            .catch(reason => {
                                console.log(reason);
                                resolve1();
                            })
                    })
                }

                if (receive.subscribe_to_update) {
console.log('send for update');
                    let toUpdate = false;
                    await Promise.all(receive.templates_id.map((template) => {
                        return new Promise(resolve1 => {
                            clientPg.query({text: queries.getLastUpdate, values: [template]})
                                .then(async result => {
                                    await Promise.all(result.rows.map(res => {
                                        return new Promise(resolve2 => {
                                            if (res.send === null) {
                                                toUpdate = true;
                                                clientPg.query({text: queries.updateUpdateLog, values: [res.convert_rule, res.date, true]})
                                                    .then(() => {
                                                        resolve2();
                                                    })
                                                    .catch(reason => {
                                                        console.log(reason);
                                                        resolve2();
                                                    })
                                            } else resolve2()
                                        })
                                    }));
                                    resolve1()
                                })
                        })
                    }));
                    if (toUpdate) {
                        await createAndSendMail(receive, readyFolder, receiverList);
                    }

                }

                if ((receive.date === null || Date.parse(receive.date) + (frequency) < Date.now()) && frequency !== 0 && frequency !== '' && receive.intervals.length <= 0) {
                    await createAndSendMail(receive, readyFolder, receiverList);
                } else if (receive.intervals.length > 0) {
                    await Promise.all(receive.intervals.map(async inter => {
                        return new Promise(async resolve1 => {
                            let date = new Date();
                            let dateTime = date.getHours() * 60 * 60 + date.getMinutes() * 60 + date.getSeconds();
                            let innerTime = inter.getHours() * 60 * 60 + inter.getMinutes() * 60 + inter.getSeconds();
                            let equal = receive.date === null ? false : date.getDate() === receive.date.getDate();
                            let lastTime = receive.date === null ? 0 : receive.date.getHours() * 60 * 60 + receive.date.getMinutes() * 60 + receive.date.getSeconds();

			
                            if (Math.abs(dateTime - innerTime) < 60) {
                                if (!equal) {

                                    await createAndSendMail(receive, readyFolder, receiverList);
                                    resolve1();
                                } else if (Math.abs(lastTime - innerTime) > 120) {

                                    await createAndSendMail(receive, readyFolder, receiverList);
                                    resolve1();
                                } else {
                                    resolve1();
                                }

                            } else {
                                resolve1();
                            }
                        });
                    }))
                }
                resolve3();
            })
        }));
        resolve();
    });
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

async function createAndSendMail(receive, readyFolder, receiverList) {
    return new Promise(async resolve => {
        var templates = await clientPg.query(queries.getRulesQuery);
        let oldDate = new Date();
        await clientPg.query({
            text: queries.insertSendLog,
            values: [receive.id, oldDate, 'pending']
        });

        let attach = [];
        try {
            if (receive.groups !== '') {
                let names = receive.result_name.split('; ');
                let counter = 0;
                receive.groups.split(', ').map(async g => {
                    let bigXlsx = [];
                    let bigName = '';
                    if (g.split(';').length > 1) {

                        await Promise.all(g.split('; ').map(async gg => {
                            return new Promise(async resolve1 => {
                                let template = templates.rows.filter(f => f.id.toString() === gg)[0].name;
                                let xlsx = await convertXlsxToArray(readyFolder + template + '.xlsx');
                                bigXlsx = bigXlsx.concat(xlsx[0].data);
                                bigName += template + ' + ';
                                resolve1();
                            })
                        }));
                        bigXlsx = bigXlsx.filter(r => r[0] !== receive.header[0][0]);
                        bigXlsx.unshift(receive.header[0]);
                        bigXlsx = await buildXlsx(bigXlsx);
                        attach.push({
                            filename: receive.result_name + (receive.xls ? '.xls' : '.xlsx'),
                            content: bigXlsx
                        });
                        fs.writeFileSync(readyFolder2 + bigName.substring(0, bigName.length - 3) + (receive.xls ? '.xls' : '.xlsx'), bigXlsx)

                    } else {
                        let template = templates.rows.filter(f => f.id.toString() === g.replace(' ', ''))[0].name;
                        attach.push({
                            filename: names[counter] + (receive.xls ? '.xls' : '.xlsx'),
                            content: fs.readFileSync(readyFolder + template + '.xlsx')
                        });
                        fs.writeFileSync(readyFolder2 + template + (receive.xls ? '.xls' : '.xlsx'), fs.readFileSync(readyFolder + template + '.xlsx'))
                    }
                    counter++;
                });
            } else {
                await Promise.all(receive.templates.map(async (elem2) => {
                    attach.push({
                        filename: receive.result_name + (receive.xls ? '.xls' : '.xlsx'),
                        content: fs.readFileSync(readyFolder + elem2 + '.xlsx')
                    });
                    fs.writeFileSync(readyFolder2 + elem2 + (receive.xls ? '.xls' : '.xlsx'), fs.readFileSync(readyFolder + elem2 + '.xlsx'))
                }));
            }
        } catch (e) {
            clientPg.query({
                text: queries.insertSendLog,
                values: [receive.id, new Date(), 'error']
            })
        }

        let receiversList = receiverList.filter(el => ~receive.receivers.indexOf(el.id));

        let result = await clientPg.query({
            text: 'SELECT * FROM SENDERS WHERE id = $1',
            values: [receive.sender]
        });

        const mailTransport = require('nodemailer').createTransport({
            host: result.rows[0].host,
            port: result.rows[0].port,
            secure: result.rows[0].port == 465 ? true : false,
            auth: {
                user: result.rows[0].email,
                pass: result.rows[0].password
            }
        });
        await Promise.all(receiversList.map(r => {
            return new Promise(resolve1 => {

            let mailOptions = {
                from: result.rows[0].email, // sender address
                to: r.email, // list of receivers
                subject: receive.title, // Subject line
                text: '', // plain text body
                attachments: attach
            };
            mailTransport.sendMail(mailOptions, (error, info) => {
                if (error) {
                    clientPg.query({
                        text: queries.changeSendLog,
                        values: [receive.id, new Date(), 'error', error + '//' + info, oldDate]
                    })
                        .then(() => {
                            resolve1();
                        })
                        .catch(reason => {
                            console.log(reason);
                            resolve1();
                        });
                } else {
                    clientPg.query({
                        text: queries.changeSendLog,
                        values: [receive.id, new Date(), 'success', info, oldDate]
                    })
                        .then(() => {
                            console.log("прайс сформирован и отослан на " + receive.receivers);
                            resolve1();
                        })
                        .catch(reason => {
                            console.log(reason);
                            resolve1();
                        });
                }
            });
            })
        }));
        resolve();
    });
}

function buildXlsx(newExcel) {
    return new Promise(async resolve => {
        xlsx.buildAsync([{
            name: "price",
            data: newExcel
        }], {}, function (error, xlsBuffer) {
            if (!error) {
                resolve(xlsBuffer);
            } else {
                console.log(error)
            }
        })
    })
}

sendPrices()
    .then(() => {
        clientPg.end();
    });

