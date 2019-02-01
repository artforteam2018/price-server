let xlsx = require('async-xlsx');
let fs = require('fs');
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

        let receiverList = await(convertDBQueryToArray(queries.getReceiverQuery));

        for (let i in receivers) {
            let receive = receivers[i];

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
                    let toUpdate = false;
                await Promise.all(receive.templates_id.map((template) => {
                    return new Promise(resolve1 => {
                        clientPg.query({text: queries.getUpdateLog, values: [template]})
                            .then(async result => {
                                await Promise.all(result.rows.map(res => {
                                    return new Promise(resolve2 => {
                                        if (res.send === null){
                                            toUpdate = true;
                                            clientPg.query({text: queries.updateUpdateLog, values: [res.convert_rule, res.date, true]})
                                                .then(()=>{
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
            if ((receive.date === null || Date.parse(receive.date) + (frequency) < Date.now()) && frequency !== 0) {
                await createAndSendMail(receive, readyFolder, receiverList);
            } else if (receive.intervals.length > 0) {
                await Promise.all(receive.intervals.map(async inter => {
                    return new Promise(async resolve1 => {
                        let date = new Date();
                        let dateTime = date.getHours() * 60 * 24 + date.getMinutes() * 60 + date.getSeconds();
                        let innerTime = inter.getHours() * 60 * 24 + inter.getMinutes() * 60 + inter.getSeconds();
                        let equal = receive.date === null ? false : date.getDate() === receive.date.getDate();
                        let lastTime = receive.date === null ? 0 : receive.date.getHours() * 60 * 24 + receive.date.getMinutes() * 60 + receive.date.getSeconds();

                        if (Math.abs(dateTime - innerTime) < 60) {
                            if (!equal) {
                                await createAndSendMail(receive, readyFolder, receiverList);
                                resolve1();
                            } else if (lastTime - innerTime > 60 * 10) {
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
        }
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

async function createAndSendMail(receive, readyFolder, receiverList){
    return new Promise(async resolve => {
        let oldDate = new Date();
        await clientPg.query({
            text: queries.insertSendLog,
            values: [receive.id, oldDate, 'pending']
        });

        let attach = [];
        try {
            await Promise.all(receive.templates.map(async (elem2) => {
                attach.push({
                    filename: readyFolder + elem2 + '.xlsx',
                    content: fs.readFileSync(readyFolder + elem2 + '.xlsx')
                });
            }));
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

        let mailOptions = {
            from: result.rows[0].email, // sender address
            to: receiversList.map(r => r.email), // list of receivers
            subject: receive.title, // Subject line
            text: '', // plain text body
            attachments: attach
        };

        const mailTransport = require('nodemailer').createTransport({
            host: result.rows[0].host,
            port: result.rows[0].port,
            secure: true,
            auth: {
                user: result.rows[0].email,
                pass: result.rows[0].password
            }
        });


        mailTransport.sendMail(mailOptions, (error, info) => {
            if (error) {
                clientPg.query({
                    text: queries.changeSendLog,
                    values: [receive.id, new Date(), 'error', error, oldDate]
                })
                    .then(()=>{
                        resolve();
                    })
                    .catch(reason => {
                        console.log(reason);
                        resolve();
                    });
            } else {
                clientPg.query({
                    text: queries.changeSendLog,
                    values: [receive.id, new Date(), 'success', info, oldDate]
                })
                    .then(() => {
                        console.log("прайс сформирован и отослан на " + receive.receivers);
                        resolve();
                    })
                    .catch(reason => {
                        console.log(reason);
                        resolve();
                    });
            }
        });
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
    .then(()=>{
        clientPg.end();
    });

