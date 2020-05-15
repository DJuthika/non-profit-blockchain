/*
# Copyright 2018 Amazon.com, Inc. or its affiliates. All Rights Reserved.
# 
# Licensed under the Apache License, Version 2.0 (the "License").
# You may not use this file except in compliance with the License.
# A copy of the License is located at
# 
#     http://www.apache.org/licenses/LICENSE-2.0
# 
# or in the "license" file accompanying this file. This file is distributed 
# on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either 
# express or implied. See the License for the specific language governing 
# permissions and limitations under the License.
#
*/

'use strict';
const shim = require('fabric-shim');
const util = require('util');

/************************************************************************************************
 * 
 * GENERAL FUNCTIONS 
 * 
 ************************************************************************************************/

/**
 * Executes a query using a specific key
 * 
 * @param {*} key - the key to use in the query
 */
async function queryByKey(stub, key) {
  console.log('============= START : queryByKey ===========');
  console.log('##### queryByKey key: ' + key);

  let resultAsBytes = await stub.getState(key); 
  if (!resultAsBytes || resultAsBytes.toString().length <= 0) {
    throw new Error('##### queryByKey key: ' + key + ' does not exist');
  }
  console.log('##### queryByKey response: ' + resultAsBytes);
  console.log('============= END : queryByKey ===========');
  return resultAsBytes;
}

/**
 * Executes a query based on a provided queryString
 * 
 * I originally wrote this function to handle rich queries via CouchDB, but subsequently needed
 * to support LevelDB range queries where CouchDB was not available.
 * 
 * @param {*} queryString - the query string to execute
 */
async function queryByString(stub, queryString) {
  console.log('============= START : queryByString ===========');
  console.log("##### queryByString queryString: " + queryString);

  // CouchDB Query
  // let iterator = await stub.getQueryResult(queryString);

  // Equivalent LevelDB Query. We need to parse queryString to determine what is being queried
  // In this chaincode, all queries will either query ALL records for a specific docType, or
  // they will filter ALL the records looking for a specific NGO, Donor, Donation, etc. So far, 
  // in this chaincode there is a maximum of one filter parameter in addition to the docType.
  let docType = "";
  let startKey = "";
  let endKey = "";
  let jsonQueryString = JSON.parse(queryString);
  if (jsonQueryString['selector'] && jsonQueryString['selector']['docType']) {
    docType = jsonQueryString['selector']['docType'];
    startKey = docType + "0";
    endKey = docType + "z";
  }
  else {
    throw new Error('##### queryByString - Cannot call queryByString without a docType element: ' + queryString);   
  }

  let iterator = await stub.getStateByRange(startKey, endKey);

  // Iterator handling is identical for both CouchDB and LevelDB result sets, with the 
  // exception of the filter handling in the commented section below
  let allResults = [];
  while (true) {
    let res = await iterator.next();

    if (res.value && res.value.value.toString()) {
      let jsonRes = {};
      console.log('##### queryByString iterator: ' + res.value.value.toString('utf8'));

      jsonRes.Key = res.value.key;
      try {
        jsonRes.Record = JSON.parse(res.value.value.toString('utf8'));
      } 
      catch (err) {
        console.log('##### queryByString error: ' + err);
        jsonRes.Record = res.value.value.toString('utf8');
      }
      // ******************* LevelDB filter handling ******************************************
      // LevelDB: additional code required to filter out records we don't need
      // Check that each filter condition in jsonQueryString can be found in the iterator json
      // If we are using CouchDB, this isn't required as rich query supports selectors
      let jsonRecord = jsonQueryString['selector'];
      // If there is only a docType, no need to filter, just return all
      console.log('##### queryByString jsonRecord - number of JSON keys: ' + Object.keys(jsonRecord).length);
      if (Object.keys(jsonRecord).length == 1) {
        allResults.push(jsonRes);
        continue;
      }
      for (var key in jsonRecord) {
        if (jsonRecord.hasOwnProperty(key)) {
          console.log('##### queryByString jsonRecord key: ' + key + " value: " + jsonRecord[key]);
          if (key == "docType") {
            continue;
          }
          console.log('##### queryByString json iterator has key: ' + jsonRes.Record[key]);
          if (!(jsonRes.Record[key] && jsonRes.Record[key] == jsonRecord[key])) {
            // we do not want this record as it does not match the filter criteria
            continue;
          }
          allResults.push(jsonRes);
        }
      }
      // ******************* End LevelDB filter handling ******************************************
      // For CouchDB, push all results
      // allResults.push(jsonRes);
    }
    if (res.done) {
      await iterator.close();
      console.log('##### queryByString all results: ' + JSON.stringify(allResults));
      console.log('============= END : queryByString ===========');
      return Buffer.from(JSON.stringify(allResults));
    }
  }
}

/************************************************************************************************
 * 
 * CHAINCODE
 * 
 ************************************************************************************************/

let Chaincode = class {

  /**
   * Initialize the state when the chaincode is either instantiated or upgraded
   * 
   * @param {*} stub 
   */
  async Init(stub) {
    console.log('=========== Init: Instantiated / Upgraded ngo chaincode ===========');
    return shim.success();
  }

  /**
   * The Invoke method will call the methods below based on the method name passed by the calling
   * program.
   * 
   * @param {*} stub 
   */
  async Invoke(stub) {
    console.log('============= START : Invoke ===========');
    let ret = stub.getFunctionAndParameters();
    console.log('##### Invoke args: ' + JSON.stringify(ret));

    let method = this[ret.fcn];
    if (!method) {
      console.error('##### Invoke - error: no chaincode function with name: ' + ret.fcn + ' found');
      throw new Error('No chaincode function with name: ' + ret.fcn + ' found');
    }
    try {
      let response = await method(stub, ret.params);
      console.log('##### Invoke response payload: ' + response);
      return shim.success(response);
    } catch (err) {
      console.log('##### Invoke - error: ' + err);
      return shim.error(err);
    }
  }

  /**
   * Initialize the state. This should be explicitly called if required.
   * 
   * @param {*} stub 
   * @param {*} args 
   */
  async initLedger(stub, args) {
    console.log('============= START : Initialize Ledger ===========');
    console.log('============= END : Initialize Ledger ===========');
  }

  /************************************************************************************************
   * 
   * Entity functions (Entity represents the unit where the action takes place. E.g. mill, farm etc.)
   * 
   ************************************************************************************************/

  /**
   * Creates a new Entity
   * 
   * @param {*} stub 
   * @param {*} args - JSON as follows:
   * {
   *    "entityRegistrationNumber":"6322",
   *    "entityName":"ABC Farm",
   *    "entityType": "Farm",
   *    "entityDescription":"We help pets in need",
   *    "address":"1 Pet street",
   *    "contactNumber":"82372837",
   *    "contactEmail":"pets@petco.com"
   * }
   */
  async createEntity(stub, args) {
    console.log('============= START : createEntity ===========');
    console.log('##### createEntity arguments: ' + JSON.stringify(args));

    // args is passed as a JSON string
    let json = JSON.parse(args);
    let key = 'entity' + json['entityRegistrationNumber'];
    json['docType'] = 'entity';

    console.log('##### createEntity payload: ' + JSON.stringify(json));

    // Check if the Entity already exists
    let entityQuery = await stub.getState(key);
    if (entityQuery.toString()) {
      throw new Error('##### createEntity - This Entity already exists: ' + json['entityRegistrationNumber']);
    }

    await stub.putState(key, Buffer.from(JSON.stringify(json)));
    console.log('============= END : createEntity ===========');
  }

  /**
   * Retrieves a specific Entity
   * 
   * @param {*} stub 
   * @param {*} args 
   */
  async queryEntity(stub, args) {
    console.log('============= START : queryEntity ===========');
    console.log('##### queryEntity arguments: ' + JSON.stringify(args));

    // args is passed as a JSON string
    let json = JSON.parse(args);
    let key = 'entity' + json['entityRegistrationNumber'];
    console.log('##### queryEntity key: ' + key);

    return queryByKey(stub, key);
  }

  /**
   * Retrieves all entities
   * 
   * @param {*} stub 
   * @param {*} args 
   */
  async queryAllEntities(stub, args) {
    console.log('============= START : queryAllEntities ===========');
    console.log('##### queryAllEntities arguments: ' + JSON.stringify(args));
 
    let queryString = '{"selector": {"docType": "entity"}}';
    return queryByString(stub, queryString);
  }

  /************************************************************************************************
   * 
   * Entry functions (Entry is an action recorded by the Entity, e.g. Fabric creation at the mill)
   * 
   ************************************************************************************************/

  /**
   * Creates a new Entry
   * 
   * @param {*} stub 
   * @param {*} args - JSON as follows:
   * {
   *   "entryId": "12341234",
   *   "orderId": "902-12344321-56788765",
   *   "entityRegistrationNumber": "6322",
   *   "entryName": "Cotton Growing",
   *   "date": {"Harvest Date": "12344321000", "Ship Date": "56788765000"},
   *   "sustainabilityCert": ["BCI_Certificate_Id"],
   *   "carrier": "",
   *   "relatedDocuments": ["Link_to_farm_profile_image"],
   *   "imageLinks" : [],
   *   "additionalMetadata": {}
   * }
   */
  async createEntry(stub, args) {
    console.log('============= START : createEntry ===========');
    console.log('##### createEntry arguments: ' + JSON.stringify(args));

    // args is passed as a JSON string
    let json = JSON.parse(args);
    let key = 'entry' + json['entryId'];
    json['docType'] = 'entry';

    console.log('##### createEntry entry: ' + JSON.stringify(json));

    // Confirm the Entity exists
    let entityKey = 'entity' + json['entityRegistrationNumber'];
    let entityQuery = await stub.getState(entityKey);
    if (!entityQuery.toString()) {
      throw new Error('##### createEntry - Cannot create entry as the Entity does not exist: ' + json['entityRegistrationNumber']);
    }

    // Check if the Entry already exists
    let entryQuery = await stub.getState(key);
    if (entryQuery.toString()) {
      throw new Error('##### createEntry - This Entry already exists: ' + json['entryId']);
    }

    await stub.putState(key, Buffer.from(JSON.stringify(json)));
    console.log('============= END : createEntry ===========');
  }

  /**
   * Retrieves all actions recorded for an orderId
   * 
   * @param {*} stub 
   * @param {*} args  - JSON as follows:
   * {
   *   TODO: add sample input
   * }
   */
  async queryEntriesByOrderId(stub, args) {
    console.log('============= START : queryEntriesByOrderId ===========');
    console.log('##### queryEntriesByOrderId arguments: ' + JSON.stringify(args));

//    TODO: The commented code below needs to be updated
//    // args is passed as a JSON string
//    let json = JSON.parse(args);
//    let queryString = '{"selector": {"docType": "action", "orderId": "' + json['orderId'] + '"}}';
//    return queryByString(stub, queryString);
    console.log('============= END : createEntry ===========');
  }

  /************************************************************************************************
   * 
   * Blockchain related functions 
   * 
   ************************************************************************************************/

  /**
   * Retrieves the Fabric block and transaction details for a key or an array of keys
   * 
   * @param {*} stub 
   * @param {*} args - JSON as follows:
   * [
   *    {"key": "a207aa1e124cc7cb350e9261018a9bd05fb4e0f7dcac5839bdcd0266af7e531d-1"}
   * ]
   * 
   */
  async queryHistoryForKey(stub, args) {
    console.log('============= START : queryHistoryForKey ===========');
    console.log('##### queryHistoryForKey arguments: ' + JSON.stringify(args));

    // args is passed as a JSON string
    let json = JSON.parse(args);
    let key = json['key'];
    let docType = json['docType']
    console.log('##### queryHistoryForKey key: ' + key);
    let historyIterator = await stub.getHistoryForKey(docType + key);
    console.log('##### queryHistoryForKey historyIterator: ' + util.inspect(historyIterator));
    let history = [];
    while (true) {
      let historyRecord = await historyIterator.next();
      console.log('##### queryHistoryForKey historyRecord: ' + util.inspect(historyRecord));
      if (historyRecord.value && historyRecord.value.value.toString()) {
        let jsonRes = {};
        console.log('##### queryHistoryForKey historyRecord.value.value: ' + historyRecord.value.value.toString('utf8'));
        jsonRes.TxId = historyRecord.value.tx_id;
        jsonRes.Timestamp = historyRecord.value.timestamp;
        jsonRes.IsDelete = historyRecord.value.is_delete.toString();
      try {
          jsonRes.Record = JSON.parse(historyRecord.value.value.toString('utf8'));
        } catch (err) {
          console.log('##### queryHistoryForKey error: ' + err);
          jsonRes.Record = historyRecord.value.value.toString('utf8');
        }
        console.log('##### queryHistoryForKey json: ' + util.inspect(jsonRes));
        history.push(jsonRes);
      }
      if (historyRecord.done) {
        await historyIterator.close();
        console.log('##### queryHistoryForKey all results: ' + JSON.stringify(history));
        console.log('============= END : queryHistoryForKey ===========');
        return Buffer.from(JSON.stringify(history));
      }
    }
  }
}
shim.start(new Chaincode());
