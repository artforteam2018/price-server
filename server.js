const express = require('express');
const bodyParser = require('body-parser');
const app = express();
const {Client} = require('pg');
const scrypt = require('scrypt');
const crypto = require("crypto");
const sha512 = require("js-sha512");
const xlsx = require('async-xlsx');
const sol = 'z7qlO?cncUIurNn}BaA}nrPoW5D6r~s9JHIyPoYblVS$qe~%~ZmT?HC7{3%pm43f' +
    'Ajkm02eLPog6F~|RAARKIMzT8DR@Yly~ePHHuSmFDy?t1lE64fWm1%~SJGYHQw6C' +
    '8}R?hCR2SJMnOF4iQrQo0CYlg$iX$GoHRmOLW09eO0C~O6wVeyyz5QjlZi5$id$?' +
    'i$3SFMK7E42jNWjkLNYuR5IZC?QRSOL@gbwuOX$n#nl2FPZzAS0@~pq6wU|JlK6l' +
    '5r5%XsVIwfubcN1qLo~Dbo*tZpXuKN|HFoy4BWiStRgkAziw|66|v7e~OOiF@p|E' +
    'saU6Cm*Ad5RNZK#{SSdLN@aF7Td{Ma@xVI}Fzhn7~??x$D~54@DvPr9nxhmA~d7O' +
    '22w4cxGo3zIdVicD*n%HJL~K1poI0lzRk}l{8T~W|Do9hSyt31mziqTa${e7Y#Dr' +
    '*tt6@Pm%qYL93It~ZnLBVeKtZPTlMGFOqgwLVnqwsDk0zAQEi*PNE8$3OcNlGfw~' +
    'eniuAX4BNM5D0JgrepD#XJ$Gy}j27OPldUj4jrZ4a6s?|?1VHZJdNWoKCEgqFFNf' +
    '3X#1NLcA{@}6W6##pV62H~~%aWqxoNG9I7Lkcuw*|71ww|w@AhyzhRiCsFk|i{0n';

let intervals = [];

//const oldBack = require('./old-back');
const queries = require('./queries');
const clientPg = new Client({
    host: 'localhost',
    port: 5432,
    user: 'postgres',
    password: '88228228',
    database: 'II'
});
clientPg.connect(null, null);

let { exec  }= require('child_process');

clientPg.query({text: queries.getSettings, values: ['Почта с прайсами']})
    .then(result => {
        let freq = result.rows.filter(row => row.name === 'Частота обновления прайсов')[0].param;
        intervals.push({name: 'backInterval', interval: setInterval(backInterval, freq * 1000 * 60)})
    });


setInterval(()=>{
    console.log('Рассылка прайсов');
    exec('node sendPrice.js',
        function (error, stdout) {
            console.log('stdout: ' + stdout);
            if (error !== null) {
                console.log('exec error: ' + error);
            }
        });
}, 15000);

let backInterval = ()=>{
    console.log('Формирование прайсов');
    exec('node --max_old_space_size=9000 old-back',
        function (error, stdout) {
            console.log('stdout: ' + stdout);
            if (error !== null) {
                console.log('exec error: ' + error);
            }
        });
}

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended: false}));

app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', "*");
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type, Token, Username, Region');
    next()
});

app.get('/', (req, res) => {
    checkToken(req)
        .then(result => res.send(result))
});

app.get('/ping', (req, res) => {
    res.send('pong');
});

app.get('/getConvertRulesComp', (req, res) => {
    checkToken(req)
        .then(() => {

            clientPg.query(queries.convert_rules_comp)
                .then(result => {
                    res.send(result.rows)
                })
                .catch(reason => console.log(reason))
        })
});

app.get('/getTemplatesComp', (req, res) => {
    checkToken(req)
        .then(() => {

            clientPg.query(queries.templates_comp)
                .then(result => {
                    res.send(result.rows)
                })
                .catch(reason => console.log(reason))
        })
});

app.get('/getReceiversComp', (req, res) => {
    checkToken(req)
        .then(() => {

            clientPg.query(queries.receivers_comp)
                .then(result => {
                    res.send(result.rows)
                })
                .catch(reason => console.log(reason))
        })
});

app.get('/getSendersComp', (req, res) => {
    checkToken(req)
        .then(() => {

            clientPg.query(queries.sender_comp)
                .then(result => {
                    res.send(result.rows)
                })
                .catch(reason => console.log(reason))
        })
});

app.get('/getHeadersComp', (req, res) => {
    checkToken(req)
        .then(() => {

            clientPg.query(queries.headers_comp)
                .then(result => {
                    res.send(result.rows)
                })
                .catch(reason => console.log(reason))
        })
});

app.get('/getReceivers', (req, res) => {
    checkToken(req)
        .then(() => {

            clientPg.query(queries.getReceiverQuery)
                .then(result => {
                    res.send(result.rows)
                })
                .catch(reason => console.log(reason))
        })
});

app.post('/changeReceivers', (req, res) => {
    checkToken(req)
        .then(() => {
            clientPg.query(queries.getReceiverQuery)
                .then(async result => {
                    let countGood = 0;
                    let countBad = 0;
                    await Promise.all(req.body.data.map(receiver => {
                        return new Promise(resolve => {
                            let oldReceiver = result.rows.filter(row => row.id === receiver.id);
                            if (oldReceiver.length > 0) {
                                if (JSON.stringify(oldReceiver[0]) !== JSON.stringify(receiver)) {
                                    let query = {
                                        text: queries.changeReceiverQuery,
                                        values: [receiver.name, receiver.email, receiver.removed, receiver.id]
                                    };
                                    clientPg.query(query)
                                        .then(() => {
                                            countGood++;
                                            resolve()
                                        })
                                        .catch(reason => {
                                                console.log(reason);
                                                countBad++;
                                                resolve();
                                            }
                                        )
                                } else {
                                    resolve()
                                }
                            } else {
                                let query = {
                                    text: queries.insertReceiverQuery,
                                    values: [receiver.name, receiver.email, false]
                                };
                                clientPg.query(query)
                                    .then(() => {
                                        countGood++;
                                        resolve()
                                    })
                                    .catch(reason => {
                                            console.log(reason);
                                            countBad++;
                                            resolve();
                                        }
                                    )
                            }
                        })
                    }));
                    res.send({success: true, good: countGood, bad: countBad})
                })
                .catch(reason => {
                    console.log(reason);
                    res.send({success: false, good: 0, bad: req.body.data.length});
                })
        })
});

app.get('/getTemplates', (req, res) => {
    checkToken(req)
        .then(() => {
            clientPg.query(queries.getRulesQuery)
                .then(result => {
                    res.send(result.rows[0].source)
                })
                .catch(reason => console.log(reason))
        })
});

app.post('/getOneRow', (req, res) => {
    checkToken(req)
        .then(() => {
            clientPg.query({text: queries.getRuleById, values: [req.body.data.rule]})
                .then(async res => {
                    let xlsxRes = await convertXlsxToArray(res.rows[0].source);
                        console.log(xlsxRes[0].data)
                })
        })
});

app.post('/changeTemplates', (req, res) => {
    checkToken(req)
        .then(() => {
            clientPg.query(queries.getRulesQuery)
                .then(async result => {
                    let countGood = 0;
                    let countBad = 0;
                    req.body.data = req.body.data.map(template => {
                        delete template.template_name;
                        delete template.headers_name;
                        return template;
                    });
                    await Promise.all(req.body.data.map(rule => {
                        return new Promise(resolve => {
                            let oldRule = result.rows.filter(row => row.id === rule.id);
                            if (oldRule.length > 0) {
                                if (JSON.stringify(oldRule[0]) !== JSON.stringify(rule)) {
                                    let query = {
                                        text: queries.changeRulesQuery,
                                        values: [rule.name, rule.template, rule.sender, rule.filter, rule['title_filter'], rule.headers, rule.removed, rule.id]
                                    };
                                    clientPg.query(query)
                                        .then(() => {
                                            countGood++;
                                            resolve()
                                        })
                                        .catch(reason => {
                                                console.log(reason);
                                                countBad++;
                                                resolve();
                                            }
                                        )
                                } else {
                                    resolve();
                                }
                            } else {
                                let query = {
                                    text: queries.insertRulesQuery,
                                    values: [rule.name, rule.template, rule.sender, rule.filter, rule['title_filter'], rule.headers, false]
                                };
                                clientPg.query(query)
                                    .then(() => {
                                        countGood++;
                                        resolve()
                                    })
                                    .catch(reason => {
                                            console.log(reason);
                                            countBad++;
                                            resolve();
                                        }
                                    )
                            }
                        })
                    }));
                    res.send({success: true, good: countGood, bad: countBad})
                })
                .catch(reason => {
                    console.log(reason);
                    res.send({success: false, good: 0, bad: req.body.data.length});
                })
        })
});

app.get('/getTemplate', (req, res) => {
    checkToken(req)
        .then(() => {
            clientPg.query(queries.getTemplateQuery)
                .then(result => {
                    res.send(result.rows)
                })
                .catch(reason => console.log(reason))
        })
});

app.post('/changeTemplate', (req, res) => {
    checkToken(req)
        .then(() => {
            clientPg.query(queries.getTemplateQuery)
                .then(async result => {
                    let countGood = 0;
                    let countBad = 0;
                    await Promise.all(req.body.data.map(rule => {
                        return new Promise(resolve => {
                            let oldRule = result.rows.filter(row => row.id === rule.id);
                            if (oldRule.length > 0) {
                                if (JSON.stringify(oldRule[0]) !== JSON.stringify(rule)) {
                                    let query = {
                                        text: queries.changeTemplateQuery,
                                        values: [rule.filters, rule.formulas, rule.unions, rule.pseudoname, rule.removed, rule.id]
                                    };
                                    clientPg.query(query)
                                        .then(() => {
                                            countGood++;
                                            resolve()
                                        })
                                        .catch(reason => {
                                                console.log(reason);
                                                countBad++;
                                                resolve();
                                            }
                                        )
                                } else {
                                    resolve()
                                }
                            } else {
                                let query = {
                                    text: queries.insertTemplateQuery,
                                    values: [rule.filters, rule.formulas, rule.unions, rule.pseudoname, false]
                                };
                                clientPg.query(query)
                                    .then(() => {
                                        countGood++;
                                        resolve()
                                    })
                                    .catch(reason => {
                                            console.log(reason);
                                            countBad++;
                                            resolve();
                                        }
                                    )
                            }
                        })
                    }));
                    res.send({success: true, good: countGood, bad: countBad})
                })
                .catch(reason => {
                    console.log(reason);
                    res.send({success: false, good: 0, bad: req.body.data.length});
                })
        })
});

app.post('/changeTable', (req, res) => {
    checkToken(req)
        .then(() => {
            req.body.data = req.body.data.map(template => {
                delete template.expandLog;
                delete template.statusBar;
                delete template.sender_name;
                delete template.templatesComp;
                delete template.receiversComp;
                if (template.frequency.days === 0 && template.frequency.hours === 0 && template.frequency.minutes === 0) {
                    template.frequency = null;
                } else {
                    template.frequency =
                        (template.frequency.days ? (template.frequency.days + ' ') : '') +
                        (template.frequency.hours ? (template.frequency.hours + ':') : ('00:')) +
                        (template.frequency.minutes ? (template.frequency.minutes + ':') : ('00:')) + '00'
                }

                template.intervals = template.intervals.map(inter => {
                    return new Date(inter);
                });
                return template;
            });
            clientPg.query(queries.getTableQuery2)
                .then(async result => {
                    let countGood = 0;
                    let countBad = 0;
                    await Promise.all(req.body.data.map(rule => {
                        return new Promise(async resolve => {
                            let oldRule = result.rows.filter(row => row.id === rule.id);
                            if (oldRule.length > 0) {

                                if (oldRule[0].frequency !== null) {
                                    oldRule[0].frequency =
                                        (oldRule[0].frequency.days ? (oldRule[0].frequency.days + ' ') : '') +
                                        (oldRule[0].frequency.hours ? (oldRule[0].frequency.hours + ':') : ('00:')) +
                                        (oldRule[0].frequency.minutes ? (oldRule[0].frequency.minutes + ':') : ('00:')) + '00';
                                }

                                if (JSON.stringify(oldRule[0]) !== JSON.stringify(rule)) {
                                    let query = {
                                        text: queries.changeTableQuery,
                                        values: [
                                            rule.rule_name,
                                            rule.sender,
                                            rule.subscribe_to_update,
                                            rule.result_name,
                                            rule.in_use,
                                            rule.intervals,
                                            rule.frequency,
                                            rule.title,
                                            rule.region,
                                            rule.send_now,
                                            rule.removed,
                                            rule.id
                                        ]
                                    };

                                    try {
                                        await clientPg.query({text: queries.deleteSendTemplates, values: [rule.id]});
                                    } catch (e) {
                                        console.log(e);
                                        resolve();
                                    }
                                    try {
                                        await clientPg.query({text: queries.deleteSendReceivers, values: [rule.id]});
                                    } catch (e) {
                                        console.log(e);
                                        resolve();
                                    }
                                    clientPg.query(query)
                                        .then(async () => {
                                            await Promise.all(rule.templates.map(temp => {
                                                return new Promise(resolve1 => {
                                                    clientPg.query({text: queries.insertSendTemplates, values: [rule.id, temp]})
                                                        .then(()=>{
                                                            resolve1();
                                                        })
                                                        .catch((reason => {
                                                            console.log(reason);
                                                            resolve1();
                                                        }))
                                                })
                                            }));
                                            await Promise.all(rule.receivers.map(temp => {
                                                return new Promise(resolve1 => {
                                                    clientPg.query({text: queries.insertSendReceivers, values: [rule.id, temp]})
                                                        .then(()=>{
                                                            resolve1();
                                                        })
                                                        .catch((reason => {
                                                            console.log(reason);
                                                            resolve1();
                                                        }))
                                                })
                                            }));
                                            countGood++;
                                            resolve()
                                        })
                                        .catch(reason => {
                                                console.log(reason);
                                                countBad++;
                                                resolve();
                                            }
                                        )
                                } else {
                                    resolve()
                                }
                            } else {
                                let query = {
                                    text: queries.insertTableQuery,
                                    values: [
                                        rule.rule_name,
                                        rule.sender,
                                        rule.subscribe_to_update,
                                        rule.result_name,
                                        rule.in_use,
                                        rule.intervals,
                                        rule.frequency,
                                        rule.title,
                                        rule.send_now,
                                        false
                                    ]
                                };
                                clientPg.query(query)
                                    .then(async result => {
                                        await Promise.all(rule.templates.map(temp => {
                                            return new Promise(resolve1 => {
                                                clientPg.query({text: queries.insertSendTemplates, values: [result.rows[0].id, temp]})
                                                    .then(()=>{
                                                        resolve1();
                                                    })
                                                    .catch((reason => {
                                                        console.log(reason);
                                                        resolve1();
                                                    }))
                                            })
                                        }));
                                        await Promise.all(rule.receivers.map(temp => {
                                            return new Promise(resolve1 => {
                                                clientPg.query({text: queries.insertSendReceivers, values: [result.rows[0].id, temp]})
                                                    .then(()=>{
                                                        resolve1();
                                                    })
                                                    .catch((reason => {
                                                        console.log(reason);
                                                        resolve1();
                                                    }))
                                            })
                                        }));
                                        countGood++;
                                        resolve()
                                    })
                                    .catch(reason => {
                                            console.log(reason);
                                            countBad++;
                                            resolve();
                                        }
                                    )
                            }
                        })
                    }));
                    res.send({success: true, good: countGood, bad: countBad})
                })
                .catch(reason => {
                    console.log(reason);
                    res.send({success: false, good: 0, bad: req.body.data.length});
                })
        })
});

app.get('/getHeaders', (req, res) => {
    checkToken(req)
        .then(() => {
            clientPg.query(queries.getHeadersQuery)
                .then(result => {
                    res.send(result.rows)
                })
                .catch(reason => console.log(reason))
        })
});

app.post('/changeHeaders', (req, res) => {
    checkToken(req)
        .then(() => {
            clientPg.query(queries.getHeadersQuery)
                .then(async result => {
                    let countGood = 0;
                    let countBad = 0;
                    await Promise.all(req.body.data.map(rule => {
                        return new Promise(resolve => {
                            let oldRule = result.rows.filter(row => row.id === rule.id);
                            if (oldRule.length > 0) {
                                if (JSON.stringify(oldRule[0]) !== JSON.stringify(rule)) {
                                    let query = {
                                        text: queries.changeHeadersQuery,
                                        values: [rule.name, rule.columns, rule.removed, rule.id]
                                    };
                                    clientPg.query(query)
                                        .then(() => {
                                            countGood++;
                                            resolve()
                                        })
                                        .catch(reason => {
                                                console.log(reason);
                                                countBad++;
                                                resolve();
                                            }
                                        )
                                } else {
                                    resolve()
                                }
                            } else {
                                let query = {
                                    text: queries.insertHeadersQuery,
                                    values: [rule.name, rule.columns, false]
                                };
                                clientPg.query(query)
                                    .then(() => {
                                        countGood++;
                                        resolve()
                                    })
                                    .catch(reason => {
                                            console.log(reason);
                                            countBad++;
                                            resolve();
                                        }
                                    )
                            }
                        })
                    }));
                    res.send({success: true, good: countGood, bad: countBad})
                })
                .catch(reason => {
                    console.log(reason);
                    res.send({success: false, good: 0, bad: req.body.data.length});
                })
        })
});

app.get('/getSenders', (req, res) => {
    checkToken(req)
        .then(() => {
            clientPg.query(queries.getSendersQuery)
                .then(result => {
                    res.send(result.rows)
                })
                .catch(reason => console.log(reason))
        })
});

app.get('/getSettings', (req, res) => {
    checkToken(req)
        .then(() => {
            clientPg.query(queries.getSettingsQuery)
                .then(result => {
                    res.send(result.rows)
                })
                .catch(reason => console.log(reason))
        })
});

app.post('/changeSettings', (req, res) => {
    checkToken(req)
        .then(async () => {
            await Promise.all(Object.keys(req.body.data).map(rule => {
                return new Promise(async resolve => {

                    await Promise.all(req.body.data[rule].map(data => {
                            return new Promise(resolve1 => {
                                if (data.name === 'Частота обновления прайсов') {
                                    let interval = intervals.filter(inter => inter.name === 'backInterval')[0];
                                    clearInterval(interval.interval);
                                    interval.interval = setInterval(backInterval, data.param*1000*60);
                                }
                                clientPg.query({
                                    text: queries.changeSettingsQuery,
                                    values: [data.param, rule, data.name]
                                })
                                    .then(() => {
                                        resolve1()
                                    })
                                    .catch(reason => {
                                            console.log(reason);
                                            resolve1();
                                        }
                                    );
                            })
                        }
                    ));
                    resolve();
                })
            }));
            res.send({success: true})
        })
});

app.post('/getSendLog', (req, res) => {
    checkToken(req)
        .then(() => {
            clientPg.query({
                text: queries.getSendLog,
                values: [req.body.rule, req.body.columns]
            })
                .then(result => {
                    res.send(result.rows)
                })
                .catch(reason => console.log(reason))
        })
});

app.post('/changeSenders', (req, res) => {
    checkToken(req)
        .then(() => {
            clientPg.query(queries.getSendersQuery)
                .then(async result => {
                    let countGood = 0;
                    let countBad = 0;
                    await Promise.all(req.body.data.map(rule => {
                        return new Promise(resolve => {
                            let oldRule = result.rows.filter(row => row.id === rule.id);
                            if (oldRule.length > 0) {
                                if (JSON.stringify(oldRule[0]) !== JSON.stringify(rule)) {
                                    let query = {
                                        text: queries.changeSendersQuery,
                                        values: [rule.name, rule.email, rule.host, rule.port, rule.password, rule.removed, rule.id]
                                    };
                                    clientPg.query(query)
                                        .then(() => {
                                            countGood++;
                                            resolve()
                                        })
                                        .catch(reason => {
                                                console.log(reason);
                                                countBad++;
                                                resolve();
                                            }
                                        )
                                } else {
                                    resolve()
                                }
                            } else {
                                let query = {
                                    text: queries.insertSendersQuery,
                                    values: [rule.name, rule.email, rule.host, rule.port, rule.password, false]
                                };
                                clientPg.query(query)
                                    .then(() => {
                                        countGood++;
                                        resolve()
                                    })
                                    .catch(reason => {
                                            console.log(reason);
                                            countBad++;
                                            resolve();
                                        }
                                    )
                            }
                        })
                    }));
                    res.send({success: true, good: countGood, bad: countBad})
                })
                .catch(reason => {
                    console.log(reason);
                    res.send({success: false, good: 0, bad: req.body.data.length});
                })
        })
});

app.post('/auth', (req, res) => {
    //todo query with username
    let queryIdentify = {
        text: queries.getUsersQuery,
        values: [req.body.username]
    };
    clientPg.query(queryIdentify)
        .then(result => {
            if (result.rows.count === 0) {
                res.send({success: false, type: 409})
            } else {
                scrypt.verifyKdf(Buffer.from(result.rows[0].pwd_hash, 'base64'), req.body.password + sol)
                    .then(
                        function (result) {
                            if (result) {
                                let username = req.body.username;
                                let token = sha512(crypto.randomBytes(32).toString('hex'));
                                let userAgent = req.headers["user-agent"];
                                let ip = req.headers.origin.substring(req.headers.origin.indexOf('//') + 2, req.headers.origin.lastIndexOf(':'));
                                let expire = new Date(Date.now() + 1000 * 60 * 60 * 24 * 365);
                                if (username.length > 0 && userAgent.length > 0 && ip.length > 0) {
                                    let queryCreateSession = {
                                        text: queries.insertSessionQuery,
                                        values: [username, token, userAgent, ip, expire]
                                    };

                                    clientPg.query(queryCreateSession)
                                        .then(
                                            async function () {
                                                res.send({
                                                    success: true,
                                                    type: 200,
                                                    token: token,
                                                    username: username,
                                                    region: (await clientPg.query({
                                                        text: queries.getRegion,
                                                        values: [username]
                                                    })).rows[0].region,
                                                    expire: expire
                                                });
                                            }, function (err) {
                                                res.send({success: false, type: 500});

                                                console.log(err)
                                            }
                                        )
                                } else {
                                    res.send({success: false, type: 500});
                                }

                            } else {
                                res.send({success: false, type: 401})
                            }
                        }, function (err) {
                            res.send({success: false, type: 500});
                            console.log(err)
                        });
            }
        }, err => {
            res.send({success: false, type: 500});
            console.log(err)
            //todo errorLint
        })
});

app.post('/reg', async (req, res) => {
    let adminPass = false;

        let adminRes = await clientPg.query({text: queries.adminQuery, values: ['admin']});

        await Promise.all(adminRes.rows.map(row => {
            return new Promise(resolve => {
                scrypt.verifyKdf(Buffer.from(row.pwd_hash, 'base64'), req.body.admin_password + sol)
                    .then((result)=>{
                        if (result) {
                            adminPass = true;
                        }
                        resolve();
                    })
                    .catch((reason)=>{
                        console.log(reason);
                        resolve();
                    })
            });
        }));


        if (adminPass) {
            let queryIdentify = {
                text: queries.getUsersQuery,
                values: [req.body.username]
            };
            clientPg.query(queryIdentify)
                .then(result => {
                    if (result.rows.length > 0) {
                        res.send({success: false, type: 409})
                    } else {
                        scrypt.kdf(req.body.password + sol, {N: 16, r: 1, p: 1}, function (err, result) {
                            let password = result.toString("base64");
                            if (req.body.username.length > 0 && password.length > 0) {
                                let queryRegister = {
                                    text: queries.insertUsersQuery,
                                    values: [req.body.username, password, req.body.region],
                                };

                                clientPg.query(queryRegister)
                                    .then(
                                        function () {
                                            res.send({success: true, type: 200})
                                        }, function (err) {
                                            res.send({success: false, type: 500});
                                            console.log(err)
                                        });
                            } else {
                                res.send({success: false, type: 500});
                            }
                        });
                    }
                }, err => {
                    console.log(err);
                    res.send({success: false, type: 500})
                })
        } else {
            res.send({success: false, type: 500})
        }
});

app.use(function (req, res, next) {
    return next();
});

const server = require('http').createServer(app);
const io = require('socket.io')(server);

io.on('connection', client => {
    client.on('disconnect', () => { /* … */
    });
    client.on('subscribe', (data) => {
        client.join(data.token);
    });
    client.on('loadTable', data => {
        checkTokenWs(data)
            .then(result => {
                if (result.success) {
                    let queryRules = {
                        text: queries.getTableQuery,
                        values: [data.region.split(',')]
                    };
                    clientPg.query(queryRules).then(result => {
                        setTimeout(()=> {
                            result.rows.forEach(row => {
                                clientPg.query({
                                    text: queries.getSendLog,
                                    values: [row.id, 4]
                                })
                                    .then(result => {
                                        io.to(data.token).emit('updateSendLog', {log: result.rows.map(row => ({date: row.date.getTime(), info: row.info, send_rule: row.send_rule, success: row.success}))});
                                    });
                            });
                        }, 200);


                        intervals.push({name: data.token , interval: setInterval(() => {
                                result.rows.forEach(row => {
                                    clientPg.query({
                                        text: queries.getSendLog,
                                        values: [row.id, 4]
                                    })
                                        .then(result => {
                                            io.to(data.token).emit('updateSendLog', {log: result.rows.map(row => ({date: row.date.getTime(), info: row.info, send_rule: row.send_rule, success: row.success}))});
                                        });
                                })
                            }, 30 * 1000)});
                        result.rows.forEach(res => {
                            res.intervals = res.intervals.map(inter => {
                                return Date.parse(inter)
                            });
                        });
                        io.to(data.token).emit('loadTableAnswer', {table: result.rows});
                    })
                }
            })
    });
});

server.listen(3535);


function checkToken(req) {
    return new Promise((resolve, reject) => {
        if (req.headers['token'] !== undefined && req.headers['username'] !== undefined) {
            let checkSession = {
                text: queries.getSessionQuery,
                values: [req.headers['token'], req.headers["user-agent"], req.headers["username"]]
            };
            clientPg.query(checkSession)
                .then(result => {
                    if (result.rows.length === 0) {
                        reject({success: false, type: 401})
                    } else {
                        if (result.rows[0].expire < new Date()) {
                            let removeSession = {
                                text: queries.getSessionQuery,
                                values: [req.headers['token'], req.headers["user-agent"], req.headers["username"]]
                            };
                            clientPg.query(removeSession)
                                .then(() => {
                                    reject({success: false, type: 426})
                                })
                        } else {
                            resolve({success: true, type: 200})
                        }
                    }
                }, err => {
                    reject({success: false, type: 426});
                    console.log(err)
                })
        }
    });
}

function checkTokenWs(req) {
    return new Promise(resolve => {
        if (req.token !== undefined && req.username !== undefined) {
            let checkSession = {
                text: queries.getSessionQuery2,
                values: [req.token, req.username]
            };
            clientPg.query(checkSession)
                .then(result => {
                    if (result.rows.length === 0) {
                        resolve({success: false, type: 401})
                    } else {
                        if (result.rows[0].expire < new Date()) {
                            let removeSession = {
                                text: queries.deleteSessionQuery,
                                values: [req.token, req.username]
                            };
                            clientPg.query(removeSession)
                                .then(() => {
                                    resolve({success: false, type: 426})
                                })
                        } else {
                            resolve({success: true, type: 200})
                        }
                    }
                })
        }
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
