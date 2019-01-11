const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const app = express();
const {Client} = require('pg');
const scrypt = require('scrypt');
const crypto = require("crypto");
const sha512 = require("js-sha512")
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


const clientPg = new Client({
  host: 'localhost',
  port: 5432,
  user: 'postgres',
  password: '88228228',
  database: 'postgres'
});
clientPg.connect(null, null);

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended: false}));


app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', "*");
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type, Token, Username');
  next()
});

app.get('/', (req, res) => {
  checkToken(req)
      .then(result => res.send(result))
});

app.get('/ping', (req, res) => {
  res.send('pong');
});

app.get('/getDialogs', (req, res) => {
  checkToken(req)
      .then(result => {
        if (result.success) {
          let queryGetDialogs = {
            text: `SELECT t2.date, t2.user2, chat_history.text
                           FROM (SELECT MAX(date) AS date, user2, MAX(uuid) AS uuid
                                 FROM (
                                        SELECT MAX(username) AS user2,
                                               MAX(date)     AS date,
                                               uuid
                                        FROM chat_history
                                        WHERE user2 = $1
                                        GROUP BY uuid
                                        UNION
                                        SELECT MAX(user2) AS user2,
                                               MAX(date)  AS date,
                                               uuid
                                        FROM chat_history
                                        WHERE username = $1
                                        GROUP BY uuid) AS t1
                                 GROUP BY user2) AS t2
                                  JOIN chat_history ON t2.uuid = chat_history.uuid AND t2.date = chat_history.date

                    `,
            values: [req.headers['username']]
          };
          clientPg.query(queryGetDialogs)
              .then(result => {
                res.send({success: true, rows: result.rows})
              })
        }
      })
});

app.post('/searchUser', (req, res) => {
  checkToken(req)
      .then(result => {
        if (result.success) {
          let queryGetDialogs = {
            text: `Select username from users WHERE username = $1`,
            values: [req.body.user]
          };
          clientPg.query(queryGetDialogs)
              .then(result => {
                res.send({success: true, data: result.rows})
              })
        }
      })
});

app.post('/auth', (req, res) => {
  //todo query with username
  let queryIdentify = {
    text: `SELECT *
               FROM users
               WHERE username = $1`,
    values: [req.body.username]
  };
  clientPg.query(queryIdentify)
      .then(result => {
        if (result.rows.count === 0) {
          res.send({success: false, type: 409})
        } else {
          console.log(result.rows[0])
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
                          text: `INSERT INTO sessions(username, token, user_agent, ip, expire)
                                               VALUES ($1, $2, $3, $4, $5)`,
                          values: [username, token, userAgent, ip, expire]
                        }

                        clientPg.query(queryCreateSession)
                            .then(
                                function () {
                                  res.send({
                                    success: true,
                                    type: 200,
                                    token: token,
                                    username: username,
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

app.post('/reg', (req, res) => {
  let queryIdentify = {
    text: `SELECT COUNT(*)
               FROM users
               WHERE username = $1`,
    values: [req.body.username]
  };
  clientPg.query(queryIdentify)
      .then(result => {
        if (result.rows[0].count > 0) {
          res.send({success: false, type: 409})
        } else {
          scrypt.kdf(req.body.password + sol, {N: 16, r: 1, p: 1}, function (err, result) {
            let password = result.toString("base64");
            if (req.body.username.length > 0 && password.length > 0) {
              let queryRegister = {
                text: 'INSERT INTO users(username, pwd_hash) VALUES($1, $2)',
                values: [req.body.username, password],
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
        //todo errorLint
      })
})

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
  })
  client.on('newMessage', data => {
    checkTokenWs(data)
        .then(result => {
          if (result.success) {
            if (data.text.length > 0 && data.username.length > 0 && data.username2.length > 0) {
              let queryUUID = {
                text: 'SELECT uuid FROM chat_history WHERE (username=$1 AND user2=$2) OR (username=$2 AND user2=$1)',
                values: [data.username, data.username2]
              }
              clientPg.query(queryUUID)
                  .then(result => {
                    if (result.rows.length > 0) {
                      let uuid = result.rows[0].uuid;
                      let query = {
                        text: 'INSERT INTO chat_history(uuid, text, date, username, user2) VALUES($1, $2, $3, $4, $5)',
                        values: [uuid, data.text, new Date(data.date), data.username, data.username2],
                      }
                      clientPg.query(query)
                          .then(
                              (result) => updateChat(data),
                              (err) => console.log(err))
                    } else {
                      let uuid = sha512(data.username+data.username2);
                      let query = {
                        text: 'INSERT INTO chat_history(uuid, text, date, username, user2) VALUES($1, $2, $3, $4, $5)',
                        values: [uuid, data.text, new Date(data.date), data.username, data.username2],
                      }
                      clientPg.query(query)
                          .then(
                              (result) => updateChat(data),
                              (err) => console.log(err))
                    }
                  })
            }
          }
        });


  });
  client.on('chatOpened', data => {
    checkTokenWs(data)
        .then(result => {
          if (result.success) {
            updateChat(data)
          }
        });
  })
});

server.listen(3535);

function updateChat(data) {
  let query;
  if (data.date === undefined) {
    query = {
      text: `SELECT *
                   FROM chat_history
                   WHERE (username = $1
                     AND user2 = $2) OR (username = $2 AND user2 = $1)`,
      values: [data.username, data.username2]
    }
  } else {
    query = {
      text: `SELECT *
                   FROM chat_history
                   WHERE date >= $1
                     AND (username = $2
                       AND user2 = $3) OR (username = $3 AND user2 = $2)`,
      values: [new Date(data.date), data.username, data.username2]
    }
  }
  clientPg.query(query)
      .then(res => {
        res.rows.forEach(row => {
          let querySessions = {
            text: 'SELECT token FROM sessions WHERE username = $1 OR username = $2',
            values: [row.username, row.user2]
          };
          clientPg.query(querySessions)
              .then(res => res.rows.forEach(session => {
                io.to(session.token).emit('newMessage', {text: row.text, date: row.date, user: row.username, user2: row.user2});
              }));

        })
      })
      .catch(e => console.log(e))
}

function checkToken(req) {
  return new Promise(resolve => {
    if (req.headers['token'] !== undefined && req.headers['username'] !== undefined) {
      let checkSession = {
        text: `SELECT *
                       FROM sessions
                       WHERE token = $1
                         AND user_agent = $2
                         AND username = $3`,
        values: [req.headers['token'], req.headers["user-agent"], req.headers["username"]]
      };
      clientPg.query(checkSession)
          .then(result => {
            if (result.rows.length === 0) {
              resolve({success: false, type: 401})
            } else {
              if (result.rows[0].expire < new Date()) {
                let removeSession = {
                  text: `DELETE
                                       FROM sessions
                                       WHERE token = $1
                                         AND user_agent = $2
                                         AND username = $3`,
                  values: [req.headers['token'], req.headers["user-agent"], req.headers["username"]]
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

function checkTokenWs(req) {
  return new Promise(resolve => {
    if (req.token !== undefined && req.username !== undefined) {
      let checkSession = {
        text: `SELECT *
                       FROM sessions
                       WHERE token = $1
                         AND username = $2`,
        values: [req.token, req.username]
      };
      clientPg.query(checkSession)
          .then(result => {
            if (result.rows.length === 0) {
              resolve({success: false, type: 401})
            } else {
              if (result.rows[0].expire < new Date()) {
                let removeSession = {
                  text: `DELETE
                                       FROM sessions
                                       WHERE token = $1
                                         AND username = $2`,
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
