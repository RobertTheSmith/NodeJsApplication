/* 
 * (c) 2017 Robert Smith
 */

var express = require('express');
var bodyParser = require('body-parser');
var https = require('https');
var request = require('request');
var multer = require('multer');
var upload = multer({storage: multer.MemoryStorage});
var jsonParser = bodyParser.json();

var currentId = 0;
var students = [];

// google cloud stuff
const Storage = require('@google-cloud/storage');
const CLOUD_BUCKET = "bobtest15";
const storage = Storage({
    projectId: "demoapplication-155500"
});
const bucket = storage.bucket(CLOUD_BUCKET);
const PORT = process.env.PORT || 3000;

const flatFileStorageLocation = 'StudentList.json';

function student(id, first, last, pic) {
    this.studentId = id;
    this.firstName = first;
    this.lastName = last;
    this.picture = pic;
}

// This should handle most normal english names. It will have problems with
// mulit part last names that are entered as 2 seperate words like:
// Robert Smith Johnson
// but I think that most people would hyphenate that name like:
// Robert Smith-Johnson
// and this will get that name.
function getFirstName(fullName) {
    var firstName;
    var lastNameFirst = fullName.split(',');
    if (lastNameFirst.length > 1) {
        // there was a comma, so it is last name first. take everything else
        // from the first ',' on. Dont want the space at the start so +1
        firstName = fullName.slice(fullName.indexOf(',') + 1, fullName.length);
    } else {
        // no comma in name so first name first. take everything up to the last
        // name. dont want the space so -1 from the start of the last name
        var firstNameFirst = fullName.split(' ');
        firstName = fullName.slice(0, fullName.indexOf(firstNameFirst[firstNameFirst.length - 1]) - 1);
    }
    return firstName;
}

function getLastName(fullName) {
    var lastName;
    var lastNameFirst = fullName.split(',');
    if (lastNameFirst.length > 1) {
        // there was a comma, so it is last name first. take first item
        lastName = lastNameFirst[0];
    } else {
        // no comma in name so first name first. take last item
        var firstNameFirst = fullName.split(' ');
        lastName = firstNameFirst[firstNameFirst.length - 1];
    }
    return lastName;
}

// functions for keeping the student list and current ID up to data
function loadStudentList(callback) {
    currentId = 0;
    students = [];
    var file = bucket.file(flatFileStorageLocation);
    var bufs = [];
    var buf;
    file.createReadStream()
            .on('error', err => {
                console.log(err);
                callback();
            })
            .on('data', chunk => {
                bufs.push(chunk);
            })
            .on('end', () => {
                // The file is fully downloaded.
                buf = Buffer.concat(bufs);
                var savedData = JSON.parse(buf);
                currentId = savedData.currentId;
                students = savedData.students;
                callback();
            });

}

function saveStudentList(callback) {
    var file = bucket.file(flatFileStorageLocation);
    var dataToSave = {
        'currentId': currentId,
        'students': students
    };
    file.save(JSON.stringify(dataToSave), err => {
        if (err) {
            console.log(err);
        }
        callback();
    });
}

var app = express();
app.set('trust proxy', true);
app.route('/students')
        .get(function (req, res) {
            // use page 4
            var formatedList = [];
            loadStudentList(() => {
                for (i = 0; i < students.length; i++) {
                    var cur = students[i];
                    formatedList.push({id: cur.studentId, fullName: cur.firstName + ' ' + cur.lastName});
                }
                res.json(formatedList);
            });

        })
        .post(upload.single('picture'), function (req, res) { // is this right?
            // use page 2
            // add a new student to the database
            console.log('Add a new student');
            var fName = getFirstName(req.body.fullName);
            var lName = getLastName(req.body.fullName);
            var fileName = fName + '_' + lName + '.jpg';

            var file = bucket.file(fileName); // google cloud thing

            const stream = file.createWriteStream()
                    .on('error', (err) => {
                        return res.end(err);
                    })
                    .on('finish', () => {
                        loadStudentList(() => {
                            var studentToAdd = new student(currentId++, fName, lName, fileName);
                            console.log(studentToAdd);
                            students.push(studentToAdd);
                            saveStudentList(() => {
                                res.end('File uploaded');
                            });
                        });
                    });

            stream.end(req.file.buffer);

        });
app.get('/randomStudent', function (req, res) {
    // use page 3
    // connect to other API and get random student details
    console.log('Request for random student');
    var randomStudent;
    var optionsget = {
        host: 'randomuser.me',
        path: '/api/?inc=name,picture',
        method: 'GET'
    };

    var reqGet = https.get(optionsget, (response) => {
        console.log('request sent');
        var msg = '';
        response.setEncoding('utf8');
        response.on('data', function (chunk) {
            msg += chunk;
        });
        response.on('end', function () {
            console.log('response received');
            var d = JSON.parse(msg);

            var fName = d.results[0].name.first;
            var lName = d.results[0].name.last;
            var pictureAddress = d.results[0].picture.medium;
            var fileName = fName + '_' + lName + '.jpg';
            console.log(fName);
            console.log(lName);
            console.log(fileName);

            var file = bucket.file(fileName);
            console.log('file aquired');
            request(pictureAddress)
                    .on('error', (err) => {
                        console.log(err);
                    })
                    .pipe(file.createWriteStream())
                    .on('finish', () => {
                        console.log('picture loaded into file');
                        loadStudentList(() => {
                            randomStudent = new student(currentId++, fName, lName, fileName);
                            students.push(randomStudent);
                            console.log(randomStudent);

                            saveStudentList(() => {

                                var bufs = [];
                                var buf;
                                file.createReadStream()
                                        .on('error', function (err) {
                                            console.log(err);
                                        })
                                        .on('data', function (chunk) {
                                            bufs.push(chunk);
                                        })
                                        .on('end', function () {
                                            // The file is fully downloaded.
                                            buf = Buffer.concat(bufs);
                                            var encodedData = buf.toString('base64');
                                            console.log('encode done');

                                            var responseBody = {
                                                studentId: randomStudent.studentId,
                                                firstName: randomStudent.firstName,
                                                lastName: randomStudent.lastName,
                                                picture: encodedData
                                            };

                                            console.log(responseBody);

                                            res.end(JSON.stringify(responseBody));
                                        });
                            });
                        });
                    });
        });
    });

    reqGet.end();
    reqGet.on('error', function (e) {
        console.error(e);
    });
    console.log('end of function reached');
});
app.use(jsonParser);
app.route('/students/:studentId')
        .get(function (req, res) {
            // use page 5
            // student details should include first name, last name, picture
            console.log('got details on :' + req.params.studentId);
            var studentToSend;
            loadStudentList(() => {
                for (i = 0; i < students.length; i++) {
                    var cur = students[i];
                    if (cur.studentId == req.params.studentId) {
                        studentToSend = cur;
                    }
                }
                res.statusCode = 200;
                res.setHeader('Content-Type', 'application/json');
                console.log(studentToSend.picture);
                var file = bucket.file(studentToSend.picture);
                var bufs = [];
                var buf;
                file.createReadStream()
                        .on('error', function (err) {
                            console.log(err);
                        })
                        .on('data', function (chunk) {
                            bufs.push(chunk);
                        })
                        .on('end', function () {
                            // The file is fully downloaded.
                            buf = Buffer.concat(bufs);
                            var encodedData = buf.toString('base64');
                            console.log('encode done');

                            var responseBody = {
                                studentId: studentToSend.studentId,
                                firstName: studentToSend.firstName,
                                lastName: studentToSend.lastName,
                                picture: encodedData
                            };

                            console.log(responseBody);

                            res.end(JSON.stringify(responseBody));
                        });
            });

        })
        .delete(function (req, res) {
            // use page 3 second item
            // delete the student with the id passed in. return success message
            console.log('deleting student :' + req.params.studentId);
            var studentToDelete;
            var indexToDeleteAt;
            loadStudentList(() => {
                for (i = 0; i < students.length; i++) {
                    var cur = students[i];
                    if (cur.studentId == req.params.studentId) {
                        studentToDelete = cur;
                        indexToDeleteAt = i;
                    }
                }
                if (indexToDeleteAt > -1 && indexToDeleteAt < students.length) {
                    students.splice(indexToDeleteAt, 1);
                }
                saveStudentList(() => {
                    console.log(studentToDelete);
                    res.json('Student deleted.');
                });
            });

        });
app.get('/', function (req, res) {
    res.send('system is working. Use /students to get a list of students');
});


app.listen(PORT);