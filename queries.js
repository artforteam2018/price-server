let getTableQuery = `SELECT rule_name,
                            sender,
                            id,
                            subscribe_to_update,
                            result_name,
                            in_use,
                            intervals,
                            frequency,
                            title,
                            region,
                            groups,
                           xls,
                            send_now,
                            MAX(date),
                            array(select t.id AS template
                                  from send_rules_templates
                                         LEFT JOIN convert_rules t ON send_rules_templates.convert_rule = t.id
                                  WHERE send_rules_templates.send_rule = send_rules.id) AS templates,
                            array(select r.id AS receiver
                                  from send_receivers
                                         LEFT JOIN receivers r on send_receivers.receiver = r.id
                                  WHERE send_receivers.send_table = send_rules.id) AS receivers,
                            array(SELECT additional_tables.id
                            FROM rules_tables
                                   LEFT JOIN additional_tables ON rules_tables.add_table = additional_tables.id
                            WHERE convert_rule = id) AS add_tables,
                            removed
                     FROM send_rules
                            LEFT JOIN (Select send_price_log.date,
                                              send_price_log.send_rule
                                       from (
                                              Select max(date) AS date, send_rule
                                              from send_price_log
                                              GROUP BY send_rule
                                            ) send_price_log_inner_1
                                              LEFT JOIN send_price_log
                                                        ON send_price_log.date = send_price_log_inner_1.date AND
                                                           send_price_log.send_rule = send_price_log_inner_1.send_rule
                     ) send_price_log_inner_2 ON send_price_log_inner_2.send_rule = id
                     WHERE removed = false AND (region = ANY($1) OR region isnull)
                     GROUP BY rule_name, sender, id, subscribe_to_update, result_name, in_use, intervals, frequency, title, removed`;

let getTableQuery2 = `SELECT rule_name,
                            sender,
                            id,
                            subscribe_to_update,
                            result_name,
                            in_use,
                            intervals,
                            frequency,
                            title,
                            region,
                             groups,
                             xls,
                            send_now,
                             array(select t.id AS template
                                   from send_rules_templates
                                          LEFT JOIN convert_rules t ON send_rules_templates.convert_rule = t.id
                                   WHERE send_rules_templates.send_rule = send_rules.id) AS templates,
                            array(select r.id AS receiver
                                  from send_receivers
                                         LEFT JOIN receivers r on send_receivers.receiver = r.id
                                  WHERE send_receivers.send_table = send_rules.id) AS receivers,
                             removed
                     FROM send_rules
                            LEFT JOIN (Select send_price_log.date,
                                              send_price_log.send_rule
                                       from (
                                              Select max(date) AS date, send_rule
                                              from send_price_log
                                              GROUP BY send_rule
                                            ) send_price_log_inner_1
                                              LEFT JOIN send_price_log
                                                        ON send_price_log.date = send_price_log_inner_1.date AND
                                                           send_price_log.send_rule = send_price_log_inner_1.send_rule
                     ) send_price_log_inner_2 ON send_price_log_inner_2.send_rule = id
                     WHERE removed = false`;

let getTableQuery3 = `SELECT rule_name,
                             sender,
                             id,
                             subscribe_to_update,
                             result_name,
                             in_use,
                             intervals,
                             frequency,
                             title,
                             region,
                             groups,
       xls,
                             date,
                             send_now,
                             array(SELECT columns FROM headers RIGHT JOIN (select t.headers AS header_id
                                   from send_rules_templates
                                          LEFT JOIN convert_rules t ON send_rules_templates.convert_rule = t.id
                                   WHERE send_rules_templates.send_rule = send_rules.id ORDER BY id LIMIT 1) ss ON headers.id = ss.header_id) AS header,
                             array(select t.name AS template
                                   from send_rules_templates
                                          LEFT JOIN convert_rules t ON send_rules_templates.convert_rule = t.id
                                   WHERE send_rules_templates.send_rule = send_rules.id ORDER BY id) AS templates,
                             array(select t.id AS template
                                   from send_rules_templates
                                          LEFT JOIN convert_rules t ON send_rules_templates.convert_rule = t.id
                                   WHERE send_rules_templates.send_rule = send_rules.id ORDER BY id) AS templates_id,
                             array(select r.id AS receiver
                                   from send_receivers
                                          LEFT JOIN receivers r on send_receivers.receiver = r.id
                                   WHERE send_receivers.send_table = send_rules.id) AS receivers,
                             removed
                      FROM send_rules
                             LEFT JOIN (
                        Select max(date) AS date, send_rule
                        from send_price_log
                        GROUP BY send_rule
                      ) send_price_log_inner_2 ON send_price_log_inner_2.send_rule = id
                      WHERE removed = false
`;

let changeTableQuery = 'UPDATE public.send_rules SET rule_name = $1, sender = $2, subscribe_to_update =$3, result_name =$4, in_use =$5, intervals =$6, frequency =$7, title =$8, region =$9, groups = $10, xls = $11, send_now =$12, removed =$13 WHERE id = $14';

let insertTableQuery = 'INSERT INTO public.send_rules(rule_name, sender, subscribe_to_update, result_name, in_use, intervals, frequency, title, send_now, groups, xls, removed) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id';

let getRulesQuery = `SELECT convert_rules.name AS name,
			    list_name,
                            sender,
                            filter,
                            title_filter,
                            convert_rules.id,
                            t.id AS template,
                            h.id AS headers,
                            convert_rules.removed,
                            convert_rules.name,
                            array(SELECT add_table
                                  FROM rules_tables
                                  WHERE rules_tables.convert_rule = convert_rules.id) AS add_tables_id
                     FROM convert_rules 
                       LEFT JOIN templates t on convert_rules.template = t.id 
                       LEFT JOIN headers h on convert_rules.headers = h.id
                     WHERE convert_rules.removed = false`;

let changeRulesQuery = 'UPDATE public.convert_rules SET name = $1, list_name =$2, template = $3, sender =$4, filter =$5, title_filter =$6, headers =$7, removed =$8 WHERE id = $9';

let insertRulesQuery = 'INSERT INTO public.convert_rules(name, list_name, template, sender, filter, title_filter, headers, removed) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)';

let getReceiverQuery = 'SELECT * FROM receivers WHERE removed = false';

let changeReceiverQuery = 'UPDATE public.receivers SET name = $1, email =$2, removed =$3 WHERE id = $4';

let insertReceiverQuery = 'INSERT INTO public.receivers(name, email, removed) VALUES($1, $2, $3)';

let getTemplateQuery = 'SELECT * FROM templates WHERE removed = false';

let changeTemplateQuery = 'UPDATE public.templates SET filters =$1, formulas =$2, unions =$3, pseudoname = $4, removed =$5 WHERE id = $6';

let insertTemplateQuery = 'INSERT INTO public.templates(filters, formulas, unions, pseudoname, removed) VALUES($1, $2, $3, $4, $5)';

let getHeadersQuery = 'SELECT * FROM headers WHERE removed = false';

let getAddQuery = 'SELECT * FROM additional_tables';

let changeHeadersQuery = 'UPDATE public.headers SET name = $1, columns =$2, removed =$3 WHERE id = $4';

let insertHeadersQuery = 'INSERT INTO public.headers(name, columns, removed) VALUES($1, $2, $3)';

let getSendersQuery = 'SELECT * FROM senders WHERE removed = false';

let changeSendersQuery = 'UPDATE public.senders SET name = $1, email =$2, host =$3, port =$4, password =$5, removed =$6 WHERE id = $7';

let insertSendersQuery = 'INSERT INTO public.senders(name, email, host, port, password, removed) VALUES($1, $2, $3, $4, $5, $6)';

let getUsersQuery = `SELECT *
                   FROM users
                   WHERE username = $1`;

let insertUsersQuery = 'INSERT INTO users(username, pwd_hash, region) VALUES($1, $2, $3)';

let insertSessionQuery = `INSERT INTO sessions(username, token, user_agent, ip, expire)
                                               VALUES ($1, $2, $3, $4, $5)`;

let getSessionQuery = `SELECT *
               FROM sessions
               WHERE token = $1
                 AND user_agent = $2
                 AND username = $3`;

let getSessionQuery2 = `SELECT *
                       FROM sessions
                       WHERE token = $1
                         AND username = $2`;

let deleteSessionQuery = `DELETE
                                       FROM sessions
                                       WHERE token = $1
                                         AND username = $2`;

let convert_rules_comp = 'Select name, id FROM convert_rules';
let templates_comp = 'Select pseudoname, id FROM templates';
let receivers_comp = 'Select name, id FROM receivers';
let sender_comp = 'Select name, id FROM senders';
let headers_comp = 'Select name, id FROM headers';
let add_comp = 'Select name, id FROM additional_tables';
let getSendLog = 'SELECT * FROM send_price_log WHERE send_rule =$1 ORDER BY date desc LIMIT $2';

let getLastUpdate = `SELECT update_price_log.date, update_price_log.convert_rule, send
                    FROM update_price_log
                           RIGHT JOIN (SELECT MAX(date) AS date, convert_rule
                                       FROM update_price_log
                                       WHERE convert_rule = (SELECT id FROM convert_rules WHERE template = $1 LIMIT 1)
                                       GROUP BY convert_rule) t ON t.convert_rule = update_price_log.convert_rule AND
                                                                   t.date = update_price_log.date
                                                                   ORDER BY date desc LIMIT $2
`;

let getUpdateLog = `SELECT *
                    FROM update_price_log
                    WHERE convert_rule = (
                      SELECT convert_rule
                      FROM send_rules_templates
                      WHERE send_rule = $1
                      LIMIT 1)
                    ORDER BY date desc
                    LIMIT $2
`;

let updateUpdateLog = 'UPDATE update_price_log SET send = $3 WHERE convert_rule = $1 AND date = $2';

let insertSendLog = 'INSERT INTO send_price_log(send_rule, date, success) VALUES ($1, $2, $3)';

let changeSendLog = 'UPDATE send_price_log SET success = $3, date = $2, info =$4 WHERE send_rule = $1 AND date = $5';

let deleteSendTemplates = `DELETE FROM send_rules_templates
                            WHERE send_rule = $1`;

let insertSendTemplates = `INSERT INTO send_rules_templates(send_rule, convert_rule)
VALUES ($1, $2)`;

let deleteSendReceivers = `DELETE FROM send_receivers
                            WHERE send_table = $1`;

let insertSendReceivers= `INSERT INTO send_receivers(send_table, receiver)
VALUES ($1, $2)`;

let getSettings = `SELECT * FROM SETTINGS WHERE folder = $1`;

let getSettingsQuery = `SELECT * FROM SETTINGS ORDER BY id`;
let getUserSettingsQuery = `SELECT region FROM users WHERE username = $1 ORDER BY id`;
let changeSettingsQuery = 'UPDATE settings SET param = $1 WHERE folder = $2 AND name = $3';
let changeUserSettingsQuery = 'UPDATE users SET region = $1 WHERE username = $2';
let adminQuery = 'SELECT * FROM users WHERE username = $1';

let getRegion = 'SELECT region FROM users WHERE username = $1';

let getRuleById = 'SELECT * FROM convert_rules WHERE id = $1';

module.exports.getTableQuery = getTableQuery;
module.exports.getTableQuery2 = getTableQuery2;
module.exports.getTableQuery3 = getTableQuery3;
module.exports.changeTableQuery = changeTableQuery;
module.exports.insertTableQuery = insertTableQuery;

module.exports.getReceiverQuery = getReceiverQuery;
module.exports.changeReceiverQuery = changeReceiverQuery;
module.exports.insertReceiverQuery = insertReceiverQuery;

module.exports.getReceiverQuery = getReceiverQuery;
module.exports.changeReceiverQuery = changeReceiverQuery;
module.exports.insertReceiverQuery = insertReceiverQuery;

module.exports.getRulesQuery = getRulesQuery;
module.exports.changeRulesQuery = changeRulesQuery;
module.exports.insertRulesQuery = insertRulesQuery;

module.exports.getTemplateQuery = getTemplateQuery;
module.exports.changeTemplateQuery = changeTemplateQuery;
module.exports.insertTemplateQuery = insertTemplateQuery;

module.exports.getHeadersQuery = getHeadersQuery;
module.exports.getAddQuery = getAddQuery;
module.exports.changeHeadersQuery = changeHeadersQuery;
module.exports.insertHeadersQuery = insertHeadersQuery;

module.exports.getSendersQuery = getSendersQuery;
module.exports.changeSendersQuery = changeSendersQuery;
module.exports.insertSendersQuery = insertSendersQuery;

module.exports.getUsersQuery = getUsersQuery;
module.exports.insertUsersQuery = insertUsersQuery;

module.exports.getSessionQuery = getSessionQuery;
module.exports.getSessionQuery2 = getSessionQuery2;
module.exports.insertSessionQuery = insertSessionQuery;
module.exports.deleteSessionQuery = deleteSessionQuery;

module.exports.convert_rules_comp = convert_rules_comp;
module.exports.templates_comp = templates_comp;
module.exports.receivers_comp = receivers_comp;
module.exports.sender_comp = sender_comp;
module.exports.headers_comp = headers_comp;
module.exports.add_comp = add_comp;

module.exports.getSendLog = getSendLog;
module.exports.insertSendLog = insertSendLog;
module.exports.changeSendLog = changeSendLog;
module.exports.getLastUpdate = getLastUpdate;
module.exports.getUpdateLog = getUpdateLog;
module.exports.updateUpdateLog = updateUpdateLog;
module.exports.deleteSendTemplates = deleteSendTemplates;
module.exports.deleteSendReceivers = deleteSendReceivers;
module.exports.insertSendTemplates = insertSendTemplates;
module.exports.insertSendReceivers = insertSendReceivers;
module.exports.getSettings = getSettings;
module.exports.getSettingsQuery = getSettingsQuery;
module.exports.getUserSettingsQuery = getUserSettingsQuery;
module.exports.changeSettingsQuery = changeSettingsQuery;
module.exports.changeUserSettingsQuery = changeUserSettingsQuery;

module.exports.adminQuery = adminQuery;
module.exports.getRegion = getRegion;

module.exports.getRuleById = getRuleById;
