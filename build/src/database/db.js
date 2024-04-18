"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isConnected = exports.dbClient = void 0;
const pg_1 = require("pg");
const pool = new pg_1.Pool({
    user: "postgres",
    host: "postgres",
    database: "rs_queue",
    password: "123",
    port: 5432,
});
let _client;
function dbClient() {
    if (_client)
        return _client;
    _client = pool.connect();
    return _client;
}
exports.dbClient = dbClient;
function isConnected() {
    return new Promise((resolve) => {
        pool.connect((err, client, release) => {
            if (err) {
                resolve(false);
                console.error('Error acquiring client', err.stack);
                return;
            }
            release(); // Release the client back to the pool
            resolve(true);
            console.log('Connection acquired');
        });
    });
}
exports.isConnected = isConnected;
exports.default = pool;
