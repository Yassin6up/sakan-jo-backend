const express = require("express");
const mysql = require("mysql");
const crypto = require("crypto");
const https = require("follow-redirects").https;
const qs = require("querystring");
const cors = require("cors");
const bodyParser = require("body-parser");
const { v4: uuidv4 } = require("uuid");
const path = require("path");
const fs = require("fs");
const app = express();
const port = 3003;
const multer = require("multer");
const http = require('http');

app.use(cors());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
// Set up multer for file uploadss

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, "uploads", "temp");
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  },
});



const upload = multer({ storage });



const db = mysql.createConnection({
  host: "5.9.215.4",
  user: "sakanwrd_testuser",
  password: "yassine6Up",
  database: "sakanwrd_sakani",
});


db.connect((err) => {
  if (err) {
    console.error('Error connecting to database:', err.stack);
    return;
  }
  console.log('Connected to MySQL database');
});



// Function to send verification code via SMS
const sendVerificationCode = async (to, message) => {
  const apiKey =
    "eyJhbGciOiJIUzI1NiJ9.eyJpZCI6ImQ0MWQ3ZGUyLTRjMWEtNDkzOC04MDczLWU0ZGI1YzZhOWVlNSIsImlhdCI6MTcxOTQzMTMwNCwiaXNzIjoxNDYzNH0.idbj22uTM9m9RIlFWtpath3bqpuz05lvoOqX62TSUuY";
  const from = "sakani";
  const postData = qs.stringify({
    sender: from,
    mobile: to,
    content: message,
  });

  const options = {
    method: "POST",
    hostname: "api.releans.com",
    path: "/v2/message",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Content-Length": Buffer.byteLength(postData),
    },
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let responseBody = "";

      res.on("data", (chunk) => {
        responseBody += chunk;
      });

      res.on("end", () => {
        resolve(responseBody);
      });
    });

    req.on("error", (error) => {
      reject(error);
    });

    req.write(postData);
    req.end();
  });
};

app.get("/",(req , res)=>{
    res.send("work" )
})
app.get("/server/status",(req , res)=>{
    res.json({message : "work"})
})

// Register a new user with phone number
app.post("/register", (req, res) => {
  const { name, phone, password } = req.body;
  if (!name || !phone || !password) {
    return res.status(400).json({
      message: "الاسم ورقم الهاتف وكلمة المرور مطلوبة",
    });
  }
  const token = crypto.randomBytes(64).toString("hex");
  const sqlInsert =
    "INSERT INTO users (name, phone, password, phone_verified, session_token) VALUES (?, ?, ?, ?, ?)";
  const verificationCode = Math.floor(1000 + Math.random() * 9000).toString();
  const message = `رمز التحقق الخاص بك هو ${verificationCode}`;

  db.query(sqlInsert, [name, phone, password, false, token], (err, result) => {
    if (err) {
      console.error(err);
      return res.status(500).json({
        message: "رقم الهاتف مستخدم بالفعل",
        error: err,
      });
    }

    // Fetch the newly inserted user from the database
    const sqlSelect = "SELECT * FROM users WHERE id = ?";
    db.query(sqlSelect, [result.insertId], (err, userResult) => {
      if (err) {
        console.error(err);
        return res.status(500).json({
          message: "خطأ في الخادم الداخلي",
          error: err,
        });
      }

      // Assuming userResult is an array with one user object, adjust as per your DB query result structure
      const registeredUser = userResult[0];

      // Send verification code via SMS
      sendVerificationCode(phone, message)
        .then((response) => {
          // Save verification code to database
          const sqlVerifyInsert =
            "INSERT INTO verifications (phone, code) VALUES (?, ?)";
          db.query(
            sqlVerifyInsert,
            [phone, verificationCode],
            (err, result) => {
              if (err) {
                return res.status(500).json({
                  message: "خطأ في الخادم الداخلي",
                  error: err,
                });
              }
              // Return user data along with registration success message
              res.status(200).json({
                message: "تم تسجيل المستخدم بنجاح.",
                user: registeredUser,
              });
            }
          );
        })
        .catch((error) => {
          console.log(error);
          res.status(500).json({
            message: "فشل في إرسال رمز التحقق",
            error: error.message,
          });
        });
    });
  });
});

app.post("/login", (req, res) => {
    const { phone, password } = req.body;
  
    if (!phone || !password) {
      return res.status(400).json({
        message: "رقم الهاتف وكلمة المرور مطلوبان!",
      });
    }
  
    const sql = "SELECT * FROM users WHERE phone = ?";
    db.query(sql, [phone], (err, results) => {
      if (err) {
        console.error(err);
        return res.status(500).json({
          message: "خطأ في الخادم الداخلي",
          error: err,
        });
      }
  
      if (results.length === 0 || results[0].password !== password) {
        return res.status(404).json({
          message: "رقم الهاتف أو كلمة المرور غير صحيحة!",
        });
      }
  
      if (!results[0].phone_verified) {
        // Phone number not verified, send verification code again
        const verificationCode = Math.floor(1000 + Math.random() * 9000).toString();
        const message = `رمز التحقق الخاص بك هو ${verificationCode}`;
        console.log("بدء إرسال رمز التحقق");
  
        sendVerificationCode(phone, message)
          .then((response) => {
            console.log(response);
  
            // Save verification code to database
            const sql = "UPDATE verifications SET code = ? WHERE phone = ?";
            db.query(sql, [verificationCode, phone], (err, result) => {
              if (err) {
                return res.status(500).json({ message: "خطأ في الخادم الداخلي", error: err });
              }
              res.status(200).json({
                message: "تم إرسال رمز التحقق مرة أخرى." ,
                userId: results[0].id , 
              });
            });
          })
          .catch((error) => {
            console.log("خطأ");
  
            res.status(500).json({
              message: "فشل في إرسال رمز التحقق",
              error: error.message,
            });
          });
  
        return; // Prevent further execution
      }
  
      // Generate a secure session token using crypto
      const sessionToken = crypto.randomBytes(64).toString("hex");
      // Update the user's session token in the database
      const updateSql = "UPDATE users SET session_token = ? WHERE id = ?";
      db.query(updateSql, [sessionToken, results[0].id], (updateErr) => {
        if (updateErr) {
          console.error(updateErr);
          return res.status(500).json({
            message: "فشل في تحديث رمز الجلسة",
            error: updateErr,
          });
        }
  
        // Send the session token to the client
        res.status(200).json({
          message: "تسجيل الدخول ناجح!",
          user: results[0],
          sessionToken: sessionToken,
        });
      });
    });
  });

app.get('/places/category-counts', (req, res) => {
  const query = `
    SELECT 
      home_type,
      COUNT(*) as count
    FROM 
      places
    WHERE 
      home_type IN ('فيلا / منزل', 'مسابح', 'صالات رياضة', 'مكاتب وعيادات', 
                    'شقة', 'مزرعة', 'ارض', 'شليهات', 'قاعات اجتماعات', 
                    'تنضيم رحلات', 'ملاعب', 'صالات رياضة')
    GROUP BY 
      home_type
  `;

  db.query(query, (error, results) => {
    if (error) {
      console.error('Error fetching category counts:', error);
      return res.status(500).json({ error: 'Database error' });
    }

    const categoryCounts = {};
    results.forEach(row => {
      categoryCounts[row.home_type] = row.count;
    });

    res.json(categoryCounts);
  });
});



// Update user details with phone number
app.post("/user/update-user", (req, res) => {
    const { id, name, password, currentpass } = req.body;
  
    if (!id || (!name && !password)) {
      return res.status(400).json({
        message: "Provide user ID and at least one field (name, password) to update",
      });
    }
  
    // Check if currentpass is provided
    if (!currentpass) {
      return res.status(200).json({
        message: "Provide current password to update",
      });
    }
  
    // Prepare SQL select query to get current password
    const selectSql = `SELECT password FROM users WHERE id = ?`;
    db.query(selectSql, [id], (err, result) => {
      if (err) {
        console.error(err);
        return res.status(500).json({
          message: "Internal server error",
          error: err,
        });
      }
  
      if (result.length === 0) {
        return res.status(200).json({
          message: "User not found",
        });
      }
  
      const storedPassword = result[0].password;
  
      // Compare currentpass with storedPassword
      if (currentpass !== storedPassword) {
        return res.status(200).json({
          message: "Current password does not match",
        });
      }
  
      // Prepare SQL update query based on provided fields
      let updateFields = [];
      let values = [];
  
      if (name) {
        updateFields.push("name = ?");
        values.push(name);
      }
      if (password) {
        updateFields.push("password = ?");
        values.push(password);
      }
  
      values.push(id); // Add user ID to the end of the values array
  
      const sql = `UPDATE users SET ${updateFields.join(", ")} WHERE id = ?`;
      db.query(sql, values, (updateErr, updateResult) => {
        if (updateErr) {
          console.error(updateErr);
          return res.status(500).json({
            message: "Internal server error",
            error: updateErr,
          });
        }
  
        if (updateResult.affectedRows === 0) {
          return res.status(200).json({
            message: "User not found",
          });
        }
  
        // Fetch the updated user data after successful 
        const selectUserSql = 'SELECT * FROM users WHERE id = ?';
        db.query(selectUserSql, [id], (selectErr, userResult) => {
          if (selectErr) {
            console.error('Error fetching updated user:', selectErr);
            return res.status(500).json({
              message: "Internal server error",
              error: selectErr,
            });
          }
  
          if (userResult.length === 0) {
            return res.status(200).json({
              message: "User not found after update",
            });
          }
  
          // Return success message along with updated user data
          res.status(200).json({
            message: "User updated successfully",
            user: userResult[0], // Updated user data
          });
        });
      });
    });
  });
  

// ================== verfication ================
app.post("/verify-phone", (req, res) => {
  const { phone, code } = req.body;
  console.log("start verify", req.body);
  if (!phone || !code) {
    return res.status(400).json({ message: "Phone number and verification code are required!" });
  }

  const sql = "SELECT * FROM verifications WHERE phone = ? AND code = ?";
  db.query(sql, [phone, code], (err, results) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ message: "Internal server error", error: err });
    }

    // if (results.length === 0) {
    //   return res.status(400).json({ message: "Invalid verification code!" });
    // }

    const updateSql = "UPDATE users SET phone_verified = true WHERE phone = ?";
    db.query(updateSql, [phone], (updateErr) => {
      if (updateErr) {
        console.error(updateErr);
        return res.status(500).json({ message: "Internal server error", error: updateErr });
      }

      const deleteSql = "DELETE FROM verifications WHERE phone = ?";
      db.query(deleteSql, [phone], (deleteErr) => {
        if (deleteErr) {
          console.error(deleteErr);
          return res.status(500).json({ message: "Internal server error", error: deleteErr });
        }

        const userSql = "SELECT * FROM users WHERE phone = ?";
        db.query(userSql, [phone], (userErr, userResults) => {
          if (userErr) {
            console.error(userErr);
            return res.status(500).json({ message: "Internal server error", error: userErr });
          }

          if (userResults.length === 0) {
            return res.status(404).json({ message: "User not found!" });
          }

          res.status(200).json({ 
            message: "Phone number verified successfully!", 
            user: userResults[0] 
          });
        });
      });
    });
  });
});





// Verify reset token and allow password reset
app.post("/reset-password", (req, res) => {
  const { phone, resetToken, newPassword } = req.body;

  if (!phone || !resetToken || !newPassword) {
    return res.status(400).json({
      message: "Phone number, reset token, and new password are required!",
    });
  }

  const currentTime = new Date();
  const sql =
    "SELECT * FROM users WHERE phone = ? AND reset_token = ? AND reset_token_expires_at > ?";
  db.query(sql, [phone, resetToken, currentTime], (err, results) => {
    if (err) {
      console.error(err);
      return res.status(500).json({
        message: "Internal server error",
        error: err,
      });
    }

    if (results.length === 0) {
      return res.status(401).json({
        message: "Invalid reset token or expired. Please request a new one.",
      });
    }

    // Update user's password with newPassword
    const updateSql = "UPDATE users SET password = ? WHERE phone = ?";
    db.query(updateSql, [newPassword, phone], (updateErr, updateResult) => {
      if (updateErr) {
        console.error(updateErr);
        return res.status(500).json({
          message: "Internal server error",
          error: updateErr,
        });
      }

      // Clear/reset the reset_token and reset_token_expires_at fields after successful password reset
      const clearResetSql =
        "UPDATE users SET reset_token = NULL, reset_token_expires_at = NULL WHERE phone = ?";
      db.query(clearResetSql, [phone], (clearErr, clearResult) => {
        if (clearErr) {
          console.error(clearErr);
          return res.status(500).json({
            message: "Internal server error",
            error: clearErr,
          });
        }

        res.status(200).json({
          message: "Password reset successful!",
        });
      });
    });
  });
});

// Function to generate a random reset token (example)
function generateResetToken() {
  return Math.random().toString(36).slice(2);
}

// ============ add post ======

// Route to handle adding a new place
// Route to handle adding a new place
const getValueOrDefault = (value, defaultValue = null) => {
  return value !== undefined && value !== null ? value : defaultValue;
};

app.post("/api/places/add",upload.fields([
  { name: "images", maxCount: 10 },
  { name: "chaletDocument", maxCount: 1 },
  { name: "poolDocument", maxCount: 1 }
]), (req, res) => {
  const {
    title,
    address,
    description,
    perks,
    extraInfo,
    maxGuests,
    price,
    ownerId,
    type,
    sellingMethod,
    ownerPhone,
    homeType,
    farmHasHouse,
    farmHasWater,
    farmHasFarmed,
    landInFaceOfStreet,
    numberOfStreetsInLand,
    spaceGeneral,
    numberOfHomeStage,
    totalStages,
    numberOfRooms,
    buyOrRent,
    rentType,
    ownerStatus,
    location,
    amenities,
    hajezDays,
    hajezType,
    variablePrices,
    publisherState,
    adsAccept,
    priceHide,
    specificDaysInCalander,
    specificDaysCalanderPrice,
    latitude,
    longitude,
    ownerName,
    poolType,
    deepPool,
    gettingCalls,
    containSdah,
    evacuation,
    tripLong,
    tripDate,
    timeOpen,
    meetingRoomType ,
    countPeople ,
    subscriptionTypeGym ,
    priceBeforeNoon	,
    priceAfterNoon
  } = req.body;

 const addedPhotos = req.files['images'] || []; // Array of file objects for images
  const chaletDocument = req.files['chaletDocument'] ? req.files['chaletDocument'][0] : null;
  const poolDocument = req.files['poolDocument'] ? req.files['poolDocument'][0] : null;

  const placeId = uuidv4();
  const folderName = placeId;
  const uploadDir = path.join(__dirname, "uploads", folderName);

  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }

  const savedPhotos = [];
  let savedChaletDocument = null;
  let savedPoolDocument = null;

  // Move uploaded photos to the unique directory
  addedPhotos.forEach((file, index) => {
    const oldPath = file.path;
    const newPath = path.join(uploadDir, `${index + 1}_${file.originalname}`);
    try {
      fs.renameSync(oldPath, newPath);
      savedPhotos.push({
        originalName: file.originalname,
        savedAs: `${index + 1}_${file.originalname}`,
      });
    } catch (err) {
      console.error("Failed to move file:", err);
      return res.status(555).json({
        message: "Internal server error",
        error: err.message,
      });
    }
  });

  // Move chaletDocument if exists
  if (chaletDocument) {
    const oldPath = chaletDocument.path;
    const newPath = path.join(uploadDir, `chalet_${chaletDocument.originalname}`);
    try {
      fs.renameSync(oldPath, newPath);
      savedChaletDocument = `chalet_${chaletDocument.originalname}`;
    } catch (err) {
      console.error("Failed to move chaletDocument:", err);
      return res.status(555).json({
        message: "Internal server error",
        error: err.message,
      });
    }
  }

  // Move poolDocument if exists
  if (poolDocument) {
    const oldPath = poolDocument.path;
    const newPath = path.join(uploadDir, `pool_${poolDocument.originalname}`);
    try {
      fs.renameSync(oldPath, newPath);
      savedPoolDocument = `pool_${poolDocument.originalname}`;
    } catch (err) {
      console.error("Failed to move poolDocument:", err);
      return res.status(555).json({
        message: "Internal server error",
        error: err.message,
      });
    }
  }

  const sql = `
    INSERT INTO places (
      title, address, photos, description, perks, extra_info, max_guests, price, owner_id, folderName,
      type, sellingMethod, ownerPhone, home_type, farm_has_house, farm_has_water, farm_has_farmed,
      land_in_face_of_street, number_of_streets_in_land, space_general, number_of_home_stage, total_stages,
      number_of_rooms, buy_or_rent, rent_type, owner_status, location, amenities, hajez_days, hajez_type,
      variable_prices, publisher_state, ads_accept, priceHide, specificDaysInCalendar, calanderDaysPrice, lat, lng,
      ownerName, poolType, deepPool, gettingCalls, containSdah, evacuation, tripLong, tripDate, timeOpen,
      poolDocument, challetDocument ,meetingRoomType , countPeople , subscriptionTypeGym , priceBeforeNoon , priceAfterNoon 
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,?,?,?,?,?,? ,? , ?)
  `;

  db.query(
    sql,
    [
      title || null, address || null, savedPhotos.map(photo => photo.savedAs).join(',')  || null, description || null, perks || null, extraInfo || null,
      maxGuests || null, price || null, ownerId || null, folderName || null, type || null, sellingMethod || null, ownerPhone || null,
      homeType || null, farmHasHouse || null, farmHasWater || null, farmHasFarmed || null, landInFaceOfStreet || null,
      numberOfStreetsInLand || null, spaceGeneral || null, numberOfHomeStage || null, totalStages || null, JSON.stringify(numberOfRooms) || null,
      buyOrRent || null, rentType || null, ownerStatus || null, location || null, JSON.stringify(amenities) || null, JSON.stringify(hajezDays) || null,
      hajezType || null, JSON.stringify(variablePrices) || null, publisherState || null, adsAccept || null, priceHide || null, JSON.stringify(specificDaysInCalander) || null,
      specificDaysCalanderPrice || null, latitude || 0, longitude || 0, ownerName || null, poolType || null, deepPool || null, gettingCalls || null,
      containSdah || null, evacuation || null, tripLong || null, tripDate || null, timeOpen || null, savedPoolDocument || null, savedChaletDocument || null , meetingRoomType || null ,
      countPeople || null , subscriptionTypeGym || null , priceBeforeNoon || null , priceAfterNoon || null
    ],
    (err, result) => {
      if (err) {
        console.log("Failed to add place:", err);
        return res.status(500).json({
          message: "Internal server error during database operation",
          error: err.message,
        });
      }
      res.status(200).json({
        message: "Place added successfully",
        placeId: result.insertId,
      });
    }
  );
});


// Route to get all places by ownerId
app.get("/api/places/by-owner/:ownerId", (req, res) => {
  const { ownerId } = req.params;
  console.log(ownerId);
  // SQL query to fetch places by ownerId
  const sql = "SELECT * FROM places WHERE owner_id = ?";
  db.query(sql, [ownerId], (err, results) => {
    if (err) {
      console.error("Failed to retrieve places:", err);
      return res.status(500).json({
        message: "Internal server error",
        error: err.message,
      });
    }
    res.status(200).json({
      message: "Places retrieved successfully",
      places: results,
    });
  });
});


app.post('/filter', (req, res) => {
  const { city, date, priceRange } = req.body;
  const [minPrice, maxPrice] = priceRange || [];

  // Basic date format validation (YYYY-MM-DD)
  const isValidDate = date && /^\d{4}-\d{2}-\d{2}$/.test(date);

  // Construct SQL query with filters
  let sql = `SELECT * FROM places WHERE 1=1`;
  const params = [];

  if (city) {
    sql += ` AND address = ?`;
    params.push(city);
  }

  if (isValidDate) {
    sql += ` AND DATE(date) = ?`;
    params.push(date);
  } else if (date) {
    return res.status(400).json({ message: 'Invalid date format. Expected format: YYYY-MM-DD' });
  }

  if (minPrice !== undefined) {
    sql += ` AND price >= ?`;
    params.push(minPrice);
  }

  if (maxPrice !== undefined) {
    sql += ` AND price <= ?`;
    params.push(maxPrice);
  }

  // Execute SQL query
  db.query(sql, params, (error, results) => {
    if (error) {
      console.error('Error querying the database:', error);
      return res.status(500).json({ message: 'Internal Server Error', error: error.code });
    }
    res.json(results);
  });
});



app.get("/api/images/:folderName/:imageName", (req, res) => {
  const { folderName, imageName } = req.params;
  const filePath = path.join(__dirname, "uploads", folderName, imageName);
  console.log(filePath);

  // Check if the file exists
  if (fs.existsSync(filePath)) {
    // Send the file as a response
    console.log("file found");
    res.sendFile(filePath);
  } else {
    // File not found
    console.log("file not found");

    res.status(404).json({ message: "File not found" });
  }
});

// Route to fetch filtered places
app.get("/api/places", (req, res) => {
  const { category, type } = req.query;

  // Base SQL query and parameters
  let sql = "SELECT * FROM places WHERE approved = ? AND active = ?";
  const queryParams = [1, 1]; // Values for `approved` and `active`

  // Add filters based on query parameters
  if (type) {
    sql += " AND buy_or_rent = ?";
    queryParams.push(type);
  }

  if (category && category.toLowerCase() !== "الكل") {
    sql += " AND home_type LIKE ?";
    queryParams.push(`%${category}%`);
  }

  console.log("Executing SQL query:", sql, "with parameters:", queryParams);

  // Execute the query
  db.query(sql, queryParams, (err, results) => {
    if (err) {
      console.error("Error fetching places:", err);

    
      return res.status(500).json({ error: "Internal Server Error" });
    }

    // Reverse results (if needed) and send response
    const places = results.reverse(); // Optional: Reverse order for display
    res.json({ places });
  });
});


// Route to fetch filtered places
app.get("/api/admin/places", (req, res) => {

  // Base SQL query with ordering: places with approved = 0 will appear at the top
  let sql = "SELECT * FROM places ORDER BY approved ASC";

  // Execute SQL query
  db.query(sql, (err, results) => {
    if (err) {
      console.error("Error fetching places:", err);
      return res.status(500).json({ error: "Internal Server Error" });
    }

    // Send the results as-is (since the order is already handled by SQL)
    res.json({ results });
  });
});



app.post("/api/places/:id/toggle-active", (req, res) => {
    
  const { id } = req.params;
  
  // SQL query to toggle the 'active' field
  const query = `
    UPDATE places 
    SET active = NOT active
    WHERE id = ?;
  `;

  // Execute the query
  db.query(query, [id], (err, result) => {
    if (err) {
      console.error("Error toggling active status:", err);
      return res.status(500).json({ error: "Internal Server Error" });
    }

    if (result.affectedRows === 0) {
      // No place found with the given id
      return res.status(404).json({ error: "Place not found" });
    }

    res.json({ message: "Place active status toggled successfully" });
  });
});



app.get('/admin/filter-places', (req, res) => {
  const {
    address = '',  // Default to an empty string if undefined
    byorRent = '',
    category = '', 
    price = '', 
    rating = '' , 
    state = ""
  } = req.query;

  // Construct the SQL query dynamically based on the provided data
  let query = 'SELECT * FROM places WHERE 1=1'; // Starting with a condition that is always true
  const queryParams = [];

  // Only add conditions if the value is not empty
  if (address.trim()) {
    query += ' AND title LIKE ?';
    queryParams.push(`%${address}%`);
  }

  if (byorRent.trim()) {
    // Split by comma and filter out empty values
    const byorRentArray = byorRent.split(',').filter(Boolean);
    
    if (byorRentArray.length > 0) {
      // Use an SQL IN clause to match any value from the byorRent array
      query += ` AND buy_or_rent IN (${byorRentArray.map(() => '?').join(', ')})`;
      queryParams.push(...byorRentArray); // Spread the array into queryParams
    }
  }

  if (category.trim()) {
    query += ' AND home_type = ?';
    queryParams.push(category);
  }

  if (price.trim()) {
    query += ' AND price = ?';
    queryParams.push(price);
  }

    if(state){
        query += ' AND approved = ?';
        queryParams.push(state);
    }
  if (rating.trim()) {
    query += ' AND favorites = ?';
    queryParams.push(rating);
  }

  // Execute the query
  db.query(query, queryParams, (err, results) => {
    if (err) {
      console.error('Database query error:', err);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
    res.json(results);
  });
});


// Add a like to a place
app.post('/like', (req, res) => {
  const { user_id, place_id } = req.body;

  if (!user_id || !place_id) {
    return res.status(400).json({ error: 'user_id and place_id are required' });
  }

  // Check if the user has already liked the place
  const checkQuery = 'SELECT * FROM favorites WHERE user_id = ? AND place_id = ?';
  db.query(checkQuery, [user_id, place_id], (err, results) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    if (results.length > 0) {
      // User has already liked the place, so unlike it
      const deleteQuery = 'DELETE FROM favorites WHERE user_id = ? AND place_id = ?';
      db.query(deleteQuery, [user_id, place_id], (err, results) => {
        if (err) {
          return res.status(500).json({ error: 'Database error' });
        }

        // Update the heartSave value in the places table
        const updateQuery = 'UPDATE places SET heartSave = heartSave - 1 WHERE id = ?';
        db.query(updateQuery, [place_id], (err, results) => {
          if (err) {
            return res.status(500).json({ error: 'Database error' });
          }

          res.status(200).json({ message: 'Like removed successfully and heartSave updated' });
        });
      });
    } else {
      // User has not liked the place, so like it
      const insertQuery = 'INSERT INTO favorites (user_id, place_id) VALUES (?, ?)';
      db.query(insertQuery, [user_id, place_id], (err, results) => {
        if (err) {
          return res.status(500).json({ error: 'Database error' });
        }

        // Update the heartSave value in the places table
        const updateQuery = 'UPDATE places SET heartSave = heartSave + 1 WHERE id = ?';
        db.query(updateQuery, [place_id], (err, results) => {
          if (err) {
            return res.status(500).json({ error: 'Database error' });
          }

          res.status(200).json({ message: 'Like added successfully and heartSave updated' });
        });
      });
    }
  });
})


app.get('/profile/places', (req, res) => {
  const ownerId = req.query.ownerId;  // assuming ownerId is passed as a query parameter

  if (!ownerId) {
    return res.status(400).json({ error: 'ownerId is required' });
  }

  // Query to fetch places for a specific ownerId
  const query = 'SELECT * FROM places WHERE owner_id = ?';
  db.query(query, [ownerId], (error, results) => {
    if (error) {
      console.error('Error fetching places:', error);
      return res.status(500).json({ error: 'Failed to fetch places' });
    }

    const ads = results.filter(place => place.buy_or_rent !== 'الحجز')
    const booking = results.filter(place => place.buy_or_rent === 'الحجز')
    
    res.json({ ads, booking });
  })


})

app.get('/api/user/:userId/likes', (req, res) => {
  const userId = req.params.userId;
  const sql = `
    SELECT p.* 
    FROM places p
    INNER JOIN favorites f ON p.id = f.place_id
    WHERE f.user_id = ?
  `;

  db.query(sql, [userId], (err, results) => {
    if (err) {
      console.error('Error fetching liked places:', err);
      return res.status(500).json({ error: 'Internal Server Error' });
    }

    res.json(results);
  });
});



app.get('/admin/places/gat/:id', (req, res) => {
  const placeId = req.params.id;

  const query = 'SELECT * FROM places WHERE id = ?';
  
  db.query(query, [placeId], (error, results) => {
    if (error) {
      console.error('Error fetching place by ID:', error);
      res.status(500).json({ error: 'Database query failed' });
    } else if (results.length === 0) {
      res.status(404).json({ error: 'Place not found' });
    } else {
      res.json(results[0]);
    }
  });
});




app.get('/api/places/:id', (req, res) => {
  const placeId = req.params.id;
  const userId = req.query.user_id; // Get user_id from query parameters
  const sql = `
    SELECT p.*, 
           CASE WHEN f.user_id IS NOT NULL THEN 1 ELSE 0 END AS liked
    FROM places p
    LEFT JOIN favorites f ON p.id = f.place_id AND f.user_id = ?
    WHERE p.id = ?
  `;

  db.query(sql, [userId, placeId], (err, results) => {
    if (err) {
      console.error('Error fetching place:', err);
      return res.status(500).json({ error: 'Internal Server Error' });
    }

    if (results.length === 0) {
      return res.status(404).json({ message: 'Place not found' });
    }
    
    res.json(results[0]); // Assuming there is only one place with this ID
  });
});

app.get('/admin/users', (req, res) => {
  const query = `
    SELECT 
      users.id,
      users.name,
      users.phone,
      users.phone_verified,
      users.created,
      COUNT(DISTINCT places.id) AS postsCount,
      COUNT(DISTINCT bookings.id) AS bookingsCount,
      COUNT(DISTINCT favorites.id) AS favoritesCount
    FROM users
    LEFT JOIN places ON places.owner_id = users.id
    LEFT JOIN bookings ON bookings.costumerId = users.id
    LEFT JOIN favorites ON favorites.user_id = users.id
    GROUP BY users.id;
  `;

  db.query(query, (err, results) => {
    if (err) {
      console.error('Error fetching users with counts:', err.stack);
      res.status(500).json({ error: err });
    } else {
      res.status(200).json(results);
    }
  });
});


app.put('/api/users/update', async (req, res) => {
  const { name, phone, password , userId } = req.body;

  // Construct the update query dynamically
  let query = 'UPDATE users SET name = ?, phone = ?';
  const queryParams = [name, phone];

  if (password) {
    // Hash the password if provided
    query += ', password = ?';
    queryParams.push(password);
  }

  query += ' WHERE id = ?';
  queryParams.push(userId);

  // Execute the query
  db.query(query, queryParams, (err, result) => {
    if (err) {
      console.error('Error updating user:', err.stack);
      return res.status(500).json({ error: 'Failed to update user' });
    }

    res.status(200).json({ message: 'User updated successfully' });
  });
});


app.post('/admin/delete/users/:id', (req, res) => {
  const userId = req.params.id;

  db.query('DELETE FROM users WHERE id = ?', [userId], (err, results) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    if (results.affectedRows === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.status(200).json({ message: 'User deleted successfully' });
  });
});

// Route to get slugs from categories_booking, categories_rent, and categories_sale
app.get('/categories/slug', (req, res) => {
  const query = `
    SELECT slug FROM categories_booking WHERE isActive = 1
    UNION
    SELECT slug FROM categories_rent WHERE isActive = 1
    UNION
    SELECT slug FROM categories_sale WHERE isActive = 1
  `;

  db.query(query, (err, results) => {
    if (err) {
      console.error('Error fetching categories:', err);
      return res.status(500).json({ error: 'Failed to fetch categories' });
    }

    // Extract the slugs from the results
    const slugs = results.map(row => row.slug);

    // Send the slugs as the response
    res.json({ slugs });
  });
});


app.get('/categories/all', (req, res) => {
  const querySale = 'SELECT * FROM categories_sale WHERE isActive = 1';
  const queryRent = 'SELECT * FROM categories_rent WHERE isActive = 1';
  const queryBooking = 'SELECT * FROM categories_booking WHERE isActive = 1';

  // Execute all three queries
  db.query(querySale, (err, saleResults) => {
    if (err) return res.status(500).json({ error: err.message });
    
    db.query(queryRent, (err, rentResults) => {
      if (err) return res.status(500).json({ error: err.message });

      db.query(queryBooking, (err, bookingResults) => {
        if (err) return res.status(500).json({ error: err.message });

        // Send combined response
        res.json({
          categoriesSale: saleResults,
          categoriesRent: rentResults,
          categoriesBooking: bookingResults
        });
      });
    });
  });
});


app.get('/categories/admin/all', (req, res) => {
  const query = `
    SELECT * FROM (
      SELECT * FROM categories_sale
      UNION
      SELECT * FROM categories_rent
      UNION
      SELECT * FROM categories_booking
    ) AS combined
    GROUP BY slug
  `;

  db.query(query, (err, results) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to fetch categories' });
    }

    // Send the combined and distinct slugs as the response
    res.json({ categories: results });
  });
});

app.put('/categories/toggle/:slug', (req, res) => {
  const { slug } = req.params;

  const queries = [
    `UPDATE categories_sale SET isActive = NOT isActive WHERE slug = ?`,
    `UPDATE categories_rent SET isActive = NOT isActive WHERE slug = ?`,
    `UPDATE categories_booking SET isActive = NOT isActive WHERE slug = ?`
  ];

  let updated = false;

  // Loop over the queries and try to update the category in each table
  queries.forEach((query, index) => {
    db.query(query, [slug], (err, result) => {
      if (err) {
        console.error(`Error updating in table ${index + 1}:`, err);
        return res.status(500).json({ error: `Failed to update category in table ${index + 1}` });
      }

      // If a row was affected, the update was successful for this table
      if (result.affectedRows > 0) {
        updated = true;
      }

      // Check after the last query has been executed
      if (index === queries.length - 1) {
        if (updated) {
          res.json({ message: `Category with slug '${slug}' updated successfully` });
        } else {
          res.status(404).json({ message: `Category with slug '${slug}' not found` });
        }
      }
    });
  });
});



app.post('/api/places/filter/spesific', (req, res) => {
  const filters = req.body;

  // Start with a base query
  let query = 'SELECT * FROM places WHERE approved = ? AND active = ?';
  const queryParams = [1, 1]; // Ensure only approved and active places are fetched

  // Add conditions dynamically based on provided filters
  if (filters.title) {
    query += ' AND title LIKE ?';
    queryParams.push(`%${filters.title}%`);
  }

  if (filters.minPrice) {
    query += ' AND price >= ?';
    queryParams.push(filters.minPrice);
  }

  if (filters.maxPrice) {
    query += ' AND price <= ?';
    queryParams.push(filters.maxPrice);
  }

  if (filters.minSpace) {
    query += ' AND space_general >= ?';
    queryParams.push(filters.minSpace);
  }

  if (filters.maxSpace) {
    query += ' AND space_general <= ?';
    queryParams.push(filters.maxSpace);
  }

  if (filters.homeType) {
    query += ' AND home_type = ?';
    queryParams.push(filters.homeType);
  }

  if (filters.features && Array.isArray(filters.features)) {
    filters.features.forEach((feature) => {
      query += ' AND JSON_CONTAINS(amenities, ?)';
      queryParams.push(JSON.stringify([feature]));
    });
  }

  if (filters.negotiation) {
    query += ' AND ads_accept = ?';
    queryParams.push(filters.negotiation);
  }

  // Debug the query and parameters for development purposes
  console.log('Executing SQL query:', query);
  console.log('Query parameters:', queryParams);

  // Execute the query
  db.query(query, queryParams, (err, results) => {
    if (err) {
      // Log detailed error information for debugging
      console.error('Error executing SQL query:', {
        message: err.message,
        stack: err.stack,
        code: err.code,
        sql: err.sql, // Log the actual query string if supported
      });

      // Set a generic error message
      let errorMessage = 'An error occurred while filtering places. Please try again later.';

      // Provide specific error messages based on known error codes
      switch (err.code) {
        case 'ER_BAD_DB_ERROR':
          errorMessage = 'Database connection issue. Please try again later.';
          break;
        case 'ER_PARSE_ERROR':
          errorMessage = 'Invalid query syntax. Please check your input.';
          break;
        case 'ER_NO_SUCH_TABLE':
          errorMessage = 'The table you are querying does not exist.';
          break;
        default:
          // For other errors, keep the generic message
          break;
      }

      return res.status(500).json({ error: errorMessage });
    }

    // Return the results if no error occurred
    res.status(200).json({ places: results });
  });
});


app.post('/ads/update/:id', upload.array('newPhotos'), (req, res) => {
  const { id } = req.params;
  const { 
    title, description, price, amenities, variable_prices, 
    selected_day_price, speceficDayInCalander, existingPhotos, 
    folderName, priceBeforeNoon, priceAfterNoon, tripDate, 
    poolType, subsGym 
  } = req.body;

  let allPhotos = [];

  // If there are existing photos (from the database)
  if (existingPhotos) {
    allPhotos = Array.isArray(existingPhotos) ? existingPhotos : [existingPhotos];
  }

  // Process and save the new photos uploaded
  try {
    if (req.files && req.files.length > 0) {
      const folderPath = path.join(__dirname, "uploads", folderName);
      
      // Ensure the folder exists or create it
      if (!fs.existsSync(folderPath)) {
        fs.mkdirSync(folderPath, { recursive: true });
      }

      // Iterate through the uploaded files and save them
        const newPhotoPaths = req.files.map(file => {
            
        const newFilePath = path.join(folderPath, `${1}_${file.filename}`);

        // Move the file from temporary location to the target folder
        try {
          fs.renameSync(file.path, newFilePath);
        } catch (err) {
          console.error(`Error moving file: ${file.filename}`, err);
          return { error: true, message: `Error moving file: ${file.filename}`, details: err.message };
        }

        return `${1}_${file.filename}`;
      }).filter(photo => typeof photo !== 'object'); // Filter out errors

      allPhotos = allPhotos.concat(newPhotoPaths);
    }
  } catch (err) {
    console.error('Error handling uploaded files:', err);
    return res.status(500).json({ message: 'Failed to upload files', error: err.message });
  }

  // Join all photo paths into a single string separated by commas
  const photos = allPhotos.join(',');

  // Initialize SQL query and parameters array
  let sql = `
    UPDATE places
    SET 
      title = ?,
      description = ?,
      price = ?,
      photos = ?,
      variable_prices = ?,
      calanderDaysPrice = ?,
      specificDaysInCalendar = ?,
      priceBeforeNoon = ?,
      priceAfterNoon = ?,
      tripDate = ?,
      poolType = ?,
      subscriptionTypeGym = ?
  `;

  const params = [
    title, description, price, photos, 
    JSON.stringify(variable_prices), 
    selected_day_price, 
    JSON.stringify(speceficDayInCalander), 
    priceBeforeNoon, priceAfterNoon, 
    tripDate, poolType, subsGym
  ];

  // Conditionally add the amenities to the SQL query and parameters array if provided
  if (amenities && amenities.length > 0) {
    sql += `, amenities = ?`;
    params.push(JSON.stringify(amenities));
  }

  // Complete the SQL query by adding the WHERE clause
  sql += ` WHERE id = ?`;
  params.push(id);

  // Execute the query
  db.query(sql, params, (err, result) => {
    if (err) {
      console.error('Error updating ad:', err);
      return res.status(500).json({ message: 'Database error', error: err.message });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Ad not found' });
    }

    res.status(200).json({ message: 'Ad updated successfully', photos });
  });
});


app.post('/delete/places/:id', (req, res) => {
  const placeId = req.params.id;

  if (!placeId) {
    return res.status(400).json({ error: 'Place ID is required' });
  }

  const query = 'DELETE FROM places WHERE id = ?';

  db.query(query, [placeId], (err, results) => {
    if (err) {
      console.error('Error deleting place:', err);
      return res.status(500).json({ error: 'Failed to delete place' });
    }

    if (results.affectedRows === 0) {
      return res.status(404).json({ error: 'Place not found' });
    }

    res.status(200).json({ message: 'Place deleted successfully' });
  });
});




// Route to get places by title
app.get("/api/search/places", (req, res) => {
  const { title } = req.query;

  const sql = "SELECT * FROM places WHERE title LIKE ?";

  db.query(sql, [`%${title}%`], (err, results) => {
    if (err) {
      console.error("Error searching places by title:", err);
      return res.status(500).json({ error: "Internal Server Error" });
    }

    // Check if results array is empty
    if (results.length === 0) {
      return res.json([]); // Return an empty array if no places found
    }

    res.json(results); // Return matching places
  });
});



app.post('/api/bookings/add', (req, res) => {
  const {
    checkIn,
    checkOut,
    resirvedDays,
    name,
    phone,
    place,
    price,
    costumerId
  } = req.body;

  // Validate the input
  if (!checkIn || !checkOut || !place || !price || !costumerId || !resirvedDays) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  const fetchUserDetails = new Promise((resolve, reject) => {
    if (name && phone) {
      // If name and phone are provided, resolve them directly
      resolve({ name, phone });
    } else {
      // Otherwise, fetch the user details from the users table
      const sql = 'SELECT name, phone FROM users WHERE id = ?';
      db.query(sql, [costumerId], (err, result) => {
        if (err) {
          reject(err);
        } else if (result.length === 0) {
          reject(new Error('User not found'));
        } else {
          resolve(result[0]);
        }
      });
    }
  });

  fetchUserDetails
    .then(user => {
      const bookingId = uuidv4();
      const insertSql = `
        INSERT INTO bookings (id, check_in, check_out, name, phone, place_id, price, costumerId)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;

      db.query(
        insertSql,
        [
          bookingId,
          checkIn,
          checkOut,
          user.name,
          user.phone,
          place,
          price,
          costumerId
        ],
        (err, result) => {
          if (err) {
            console.error('Error adding booking:', err);
            return res.status(501).json({ error: 'Error adding booking' });
          }

          // Update the places table with resirvedDays
          const updatePlacesSql = `
            UPDATE places 
            SET notAllowedDays = ? 
            WHERE id = ?`;

          db.query(updatePlacesSql, [resirvedDays, place], (err, result) => {
            if (err) {
              console.error('Error updating places:', err);
              return res.status(502).json({ error: 'Error updating places' });
            }

            res.status(200).json({
              message: 'Booking added successfully',
              bookingId
            });
          });
        }
      );
    })
    .catch(error => {
      console.error('Error fetching user details:', error);
      res.status(505).json({ error: error.message });
    });
});

// Update user name
app.post("/user/update-name", (req, res) => {
  const { id, name } = req.body;

  if (!id || !name) {
    return res.status(400).json({
      message: "Provide user ID and name to update",
    });
  }

  // Prepare SQL update query for updating the name
  const sql = `UPDATE users SET name = ? WHERE id = ?`;
  db.query(sql, [name, id], (updateErr, updateResult) => {
    if (updateErr) {
      console.error(updateErr);
      return res.status(500).json({
        message: "Internal server error",
        error: updateErr,
      });
    }

    if (updateResult.affectedRows === 0) {
      return res.status(200).json({
        message: "User not found",
      });
    }

    // Fetch the updated user data after successful update
    const selectUserSql = 'SELECT * FROM users WHERE id = ?';
    db.query(selectUserSql, [id], (selectErr, userResult) => {
      if (selectErr) {
        console.error('Error fetching updated user:', selectErr);
        return res.status(500).json({
          message: "Internal server error",
          error: selectErr,
        });
      }

      if (userResult.length === 0) {
        return res.status(200).json({
          message: "User not found after update",
        });
      }

      // Return success message along with updated user data
      res.status(200).json({
        message: "User name updated successfully",
        user: userResult[0], // Updated user data
      });
    });
  });
});


// Route to get bookings by customer ID
app.get("/api/bookings", (req, res) => {
  const { costumerId } = req.query;
  const sql = "SELECT * FROM bookings WHERE costumerId = ?";

  db.query(sql, [costumerId], (err, results) => {
    if (err) {
      console.error("Error fetching bookings by customer ID:", err);
      return res.status(500).json({ error: "Internal Server Error" });
    }

    res.json({ bookings: results });
  });
  
});

app.get('/bookings/getTitles/:place_id', (req, res) => {
  const placeId = req.params.place_id;

  const query = `
    SELECT id, check_in, check_out
    FROM bookings
    WHERE place_id = ?
  `;

  db.query(query, [placeId], (err, results) => {
    if (err) {
      return res.status(500).json({ error: 'Database query failed' });
    }

    // Format the results
    const formattedResults = results.map(booking => ({
      id: booking.id,
      ckeckIn: booking.check_in ,
      chekcOut : booking.check_out
    }));

    res.json(formattedResults);
  });
});


app.get("/api/bookings/get/:id", (req, res) => {
  const { id } = req.params;
  const sql = "SELECT * FROM bookings WHERE id = ?";

  db.query(sql, [id], (err, bookingResult) => {
    if (err) {
      console.error("Error getting booking by ID:", err);
      return res.status(500).json({ error: "Internal Server Error" });
    }

    if (bookingResult.length === 0) {
      return res.status(404).json({ error: "Booking not found" });
    }

    const booking = bookingResult[0];
    const placeSql = "SELECT * FROM places WHERE id = ?";

    db.query(placeSql, [booking.place_id], (err, placeResult) => {
      if (err) {
        console.error("Error getting place details:", err);
        return res.status(500).json({ error: "Internal Server Error" });
      }

      if (placeResult.length === 0) {
        console.error("Place not found for booking:", booking.id);
        return res.status(500).json({ error: "Place not found for booking" });
      }

      const place = placeResult[0];
      // Combine booking and place details
      const bookingWithPlace = {
        ...booking,
        place: place,
      };

      res.json(bookingWithPlace);
    });
  });
});



app.post('/check-phone', async (req, res) => {
  const { phoneNumber } = req.body;

  try {
    // Check if phone number exists
      const sql = 'SELECT * FROM users WHERE phone = ?';

  db.query(sql, [phoneNumber], (err, result) => {
    if (err) {
      // Handle database query error
      console.error('Database query error:', err);
      callback({ success: false, message: 'An error occurred while retrieving user' });
      return;
    }

    if (result.length > 0) {
      // User found
              const verificationCode = Math.floor(1000 + Math.random() * 9000).toString();

                let message = ` رمز استرجاع كلمة المرور هو ${verificationCode}` 
         // Send verification code via SMS
      sendVerificationCode(phoneNumber, message)
        .then((response) => {
          
              // Return user data along with registration success message
              res.status(200).json({
                message: "phone found and the data token was sent to phone number",
                success: true ,
                code : verificationCode
              });
            
        
        })
        .catch((error) => {
          console.log(error);
          res.status(500).json({
            message: "Failed to send verification code",
            error: error.message,
          });
        });
        
 
    }else{
         res.status(200).json({
                success: false ,
           });
            
    }
  });
    
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});



app.post('/reset-password-forget', (req, res) => {
  const { phoneNumber, newPassword } = req.body;

  // Check if phone number exists
  const sql = 'SELECT * FROM users WHERE phone = ?';
  db.query(sql, [phoneNumber], (err, result) => {
    if (err) {
      console.error('Database query error:', err);
      return res.status(500).json({ success: false, message: 'An error occurred while retrieving user' });
    }

    if (result.length > 0) {
      // Update the password in the database
      const updateSql = 'UPDATE users SET password = ? WHERE phone = ?';
      db.query(updateSql, [newPassword, phoneNumber], (err, updateResult) => {
        if (err) {
          console.error('Database update error:', err);
          return res.status(500).json({ success: false, message: 'An error occurred while updating password' });
        }

        if (updateResult.affectedRows > 0) {
          // Retrieve the updated user information
          const userSql = 'SELECT * FROM users WHERE phone = ?';
          db.query(userSql, [phoneNumber], (err, updatedUser) => {
            if (err) {
              console.error('Database query error:', err);
              return res.status(500).json({ success: false, message: 'An error occurred while retrieving updated user data' });
            }
            
            

            // Send the response with updated user data
            res.json({ 
              success: true, 
              message: 'Password updated successfully',
              user: updatedUser[0] // Return the first user record
            });
          });
        } else {
          // Phone number not found after update
          res.status(400).json({ success: false, message: 'Phone number not found' });
        }
      });
    } else {
      // Phone number not found
      res.status(400).json({ success: false, message: 'Phone number not found' });
    }
  });
})




app.post('/user/phone-verification', (req, res) => {
    const { id, phone } = req.body;

    // First, check if the phone number is already in use by another user
    const checkPhoneQuery = 'SELECT * FROM users WHERE phone = ?';
    
    db.query(checkPhoneQuery, [phone], (err, results) => {
        if (err) {
            console.error('Error checking phone number:', err);
            return res.status(500).json({
                message: 'Server error',
                error: err.message,
            });
        }

        if (results.length > 0) {
            // If the phone number is already in use, return an error message
            return res.status(400).json({
                message: 'Phone number is already used by another user',
                success: false,
            });
        }

        // If the phone number is not in use, proceed to send the verification code
        const verificationCode = Math.floor(1000 + Math.random() * 9000).toString();
        const message = `رمز التحقق من الرقم الجديد ${verificationCode}`;

        sendVerificationCode(phone, message)
            .then((response) => {
                // Return success message with the verification code
                res.status(200).json({
                    message: 'Phone verification code sent successfully',
                    success: true,
                    code: verificationCode,
                });
            })
            .catch((error) => {
                console.error('Error sending verification code:', error);
                res.status(500).json({
                    message: 'Failed to send verification code',
                    error: error.message,
                });
            });
    });
});





app.post('/user/update-phone', (req, res) => {
    const userId = req.body.id;
    const newPhone = req.body.phone;

    if (!newPhone) {
        return res.status(400).json({ error: 'Phone number is required' });
    }

    const sql = 'UPDATE users SET phone = ? WHERE id = ?';
    
    db.query(sql, [newPhone, userId], (err, result) => {
        if (err) {
            console.error('Error updating phone number:', err);
            return res.status(500).json({ error: 'Failed to update phone number' });
        }

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json({ message: 'Phone number updated successfully' });
    });
});



// filter

app.get('/places/filter/city', async (req, res) => {
    try {
        const { longitude, latitude, name } = req.query;

        if (!longitude || !latitude || !name) {
            return res.status(400).json({ error: 'Longitude, latitude, and name are required' });
        }

        // Convert latitude and longitude to float
        const lat = parseFloat(latitude);
        const lng = parseFloat(longitude);

        if (isNaN(lat) || isNaN(lng)) {
            return res.status(400).json({ error: 'Invalid latitude or longitude' });
        }

        // MySQL query with additional conditions for approved and active
        const query = `
            SELECT *, 
            (
                6371 * acos(
                    cos(radians(?)) * cos(radians(lat)) * 
                    cos(radians(lng) - radians(?)) + 
                    sin(radians(?)) * sin(radians(lat))
                )
            ) AS distance
            FROM places
            WHERE (address LIKE ? 
            OR (
                6371 * acos(
                    cos(radians(?)) * cos(radians(lat)) * 
                    cos(radians(lng) - radians(?)) + 
                    sin(radians(?)) * sin(radians(lat))
                ) <= 10
            ))
            AND approved = true
            AND active = true
            HAVING distance IS NOT NULL
            ORDER BY distance;
        `;

        const values = [lat, lng, lat, `%${name}%`, lat, lng, lat];
        
        db.query(query, values, (error, results) => {
            if (error) {
                console.error('Database query error:', error); // Log the error for debugging
                return res.status(500).json({ error: 'Database query failed' });
            }
            
            // Debugging: log query results
            console.log('Query results:', results);
            
            if (results.length === 0) {
                return res.status(200).json([]);
            }

            res.json({ places: results });
        });
    } catch (error) {
        console.error('Server error:', error); // Log the error for debugging
        res.status(500).json({ error: 'Server error' });
    }
});

function generateRandomToken(length) {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let token = '';
    for (let i = 0; i < length; i++) {
        const randomIndex = Math.floor(Math.random() * characters.length);
        token += characters[randomIndex];
    }
    return token;
}


app.post('/api/admin/login', (req, res) => {
  const { phone, password } = req.body;
        
  if (!phone || !password) {
    return res.status(400).json({ message: 'يرجى إدخال رقم الهاتف وكلمة المرور' });
  }

  // Query to check if the admin exists with the provided phone and password
  const sql = 'SELECT * FROM admins WHERE phone = ? AND password = ?';
  db.query(sql, [phone, password], (err, results) => {
    if (err) {
      console.error('Error querying the database:', err);
      return res.status(500).json({ message: 'خطأ في الخادم' });
    }

    if (results.length > 0) {
      // Admin exists
      const adminData = results[0]; // Get the admin data

      // Generate a random token
      const token = generateRandomToken(10);

      // Update the token in the admins table
      const updateTokenSql = 'UPDATE admins SET token = ? WHERE phone = ?';
      db.query(updateTokenSql, [token, phone], (err) => {
        if (err) {
          console.error('Error updating the token:', err);
          return res.status(500).json({ message: 'خطأ في تحديث الرمز' });
        }

        // Respond with the token and admin data
        return res.json({ token, admin: adminData });
      });
    } else {
      // Admin not found or incorrect password
      return res.status(401).json({ message: 'رقم الهاتف أو كلمة المرور غير صحيحة' });
    }
  });
});



app.get('/admin/counts', (req, res) => {
  // Initialize an object to store all the counts
  const counts = {};

  // Step 1: Count total places
  db.query('SELECT COUNT(*) AS totalAdvertient FROM places', (err, results) => {
    if (err) {
      console.error('Error fetching total places:', err);
      return res.status(500).send('Error fetching data');
    }

    counts.totalAdvertient = results[0].totalAdvertient;

    // Step 2: Count total users
    db.query('SELECT COUNT(*) AS totalUsers FROM users', (err, results) => {
      if (err) {
        console.error('Error fetching total users:', err);
        return res.status(500).send('Error fetching data');
      }

      counts.totalUsers = results[0].totalUsers;

      // Step 3: Count places where accepted = false
      db.query('SELECT COUNT(*) AS addsnotaprovi FROM places WHERE approved = 0', (err, results) => {
        if (err) {
          console.error('Error fetching not accepted places:', err);
          return res.status(500).send('Error fetching data');
        }

        counts.addsnotaprovi = results[0].addsnotaprovi;

        // Step 4: Count total bookings
        db.query('SELECT COUNT(*) AS bookingNumbe FROM bookings', (err, results) => {
          if (err) {
            console.error('Error fetching total bookings:', err);
            return res.status(500).send('Error fetching data');
          }

          counts.bookingNumbe = results[0].bookingNumbe;

          // Finally, send the response with all counts
          res.json(counts);
        });
      });
    });
  });
});



app.get('/admins', (req, res) => {
  const query = 'SELECT * FROM admins';
  db.query(query, (err, results) => {
    if (err) {
      return res.status(500).json({ error: 'Database error', details: err });
    }
    res.json(results);
  });
});

app.post('/admins', (req, res) => {
  const { phone, password, role , name } = req.body;

  if (!phone || !password || !role) {
    return res.status(400).json({ error: 'Phone, password, and role are required' });
  }

  const query = 'INSERT INTO admins (phone, password, role , name) VALUES (?, ?, ? , ?)';
  db.query(query, [phone, password, role , name], (err, results) => {
    if (err) {
      return res.status(500).json({ error: 'Database error', details: err });
    }
    res.status(201).json({ message: 'Admin added successfully', adminId: results.insertId });
  });
});


app.delete('/admins/:id', (req, res) => {
  const adminId = req.params.id;

  const query = 'DELETE FROM admins WHERE id = ?';
  db.query(query, [adminId], (err, results) => {
    if (err) {
      return res.status(500).json({ error: 'Database error', details: err });
    }
    if (results.affectedRows === 0) {
      return res.status(404).json({ error: 'Admin not found' });
    }
    res.json({ message: 'Admin removed successfully' });
  });
});


app.delete('/places/:id', (req, res) => {
  const placeId = req.params.id;

  const query = 'DELETE FROM places WHERE id = ?';
  db.query(query, [placeId], (err, results) => {
    if (err) {
      return res.status(500).json({ error: 'Database error', details: err });
    }
    if (results.affectedRows === 0) {
      return res.status(404).json({ error: 'Place not found' });
    }
    res.json({ message: 'Place deleted successfully' });
  });
});

app.put('/places/:id/approve', (req, res) => {
  const placeId = req.params.id;

  // This query toggles the 'approved' column between true and false
  const query = 'UPDATE places SET approved = NOT approved WHERE id = ?';
  db.query(query, [placeId], (err, results) => {
    if (err) {
      return res.status(500).json({ error: 'Database error', details: err });
    }
    if (results.affectedRows === 0) {
      return res.status(404).json({ error: 'Place not found' });
    }
    res.json({ message: 'Place approval status updated successfully' });
  });
});



app.delete('/bookings/:id', (req, res) => {
  const bookingId = req.params.id;

  const query = 'DELETE FROM bookings WHERE id = ?';
  db.query(query, [bookingId], (err, results) => {
    if (err) {
      return res.status(500).json({ error: 'Database error', details: err });
    }
    if (results.affectedRows === 0) {
      return res.status(404).json({ error: 'Booking not found' });
    }
    res.json({ message: 'Booking deleted successfully' });
  });
});

const slidersDirectory = path.join(__dirname, 'uploads', 'sliders');

const iconsDirectory = path.join(__dirname, 'uploads', 'icons');


app.post('/api/slides', upload.single('slide'), (req, res) => {
  const file = req.file;
  const {serviceId} = req.body

  if (!file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const tempFilePath = path.join(__dirname, 'uploads', 'temp', file.filename);
  const sliderFilePath = path.join(__dirname, 'uploads', 'sliders', file.filename); // Path for sliders

  // Move the file to the sliders directory
  fs.rename(tempFilePath, sliderFilePath, (err) => {
    if (err) {
      console.error('Error moving file to sliders directory:', err);
      return res.status(500).json({ error: 'Could not move file' });
    }

    const filePath = `${file.filename}`; // Relative path for the DB

    // Prepare a query to insert the slide into the database
    const query = `INSERT INTO sliders (name, file_path , serviceId) VALUES ?`;
    const values = [[file.originalname, filePath , serviceId]]; // Single entry as an array

    db.query(query, [values], (err, result) => {
      if (err) {
        console.error('Error inserting data into database:', err);
        return res.status(500).json({ error: 'Database error' });
      }

      // Send a success response back to the client
      res.json({ slide: { name: file.originalname, file_path : filePath } });
    });
  });
});



app.use('/uploads/sliders', express.static(path.join(__dirname, 'uploads/sliders')));

// Route to fetch all slider images
app.get('/api/slides', (req, res) => {
  const query = 'SELECT * FROM sliders';

  db.query(query, (err, results) => {
    if (err) {
      console.error('Error fetching data from database:', err);
      return res.status(500).json({ error: 'Database error' });
    }

    // Send back the slider data (name and path)
    res.json(results);
  });
});



// Route to get a specific image by file name
app.get('/api/slides/single/:fileName', (req, res) => {
  const { fileName } = req.params;

  // Construct the full file path
  const filePath = path.join(slidersDirectory, fileName);

  // Check if the file exists
  fs.access(filePath, fs.constants.F_OK, (err) => {
    if (err) {
      return res.status(404).json({ message: 'File not found' });
    }

    // Send the file
    res.sendFile(filePath, (err) => {
      if (err) {
        console.error('Error sending file:', err);
        res.status(500).json({ message: 'Error sending file' });
      }
    });
  });
});

app.get('/api/icons/single/:fileName', (req, res) => {
  const { fileName } = req.params;

  // Construct the full file path
  const filePath = path.join(iconsDirectory, fileName);

  // Check if the file exists
  fs.access(filePath, fs.constants.F_OK, (err) => {
    if (err) {
      return res.status(404).json({ message: 'File not found' });
    }

    // Send the file
    res.sendFile(filePath, (err) => {
      if (err) {
        console.error('Error sending file:', err);
        res.status(500).json({ message: 'Error sending file' });
      }
    });
  });
});

app.delete('/api/slides/:fileName', (req, res) => {
  const { fileName } = req.params;

  // Construct the full file path
  const filePath = path.join(slidersDirectory, fileName);

  // Remove the file from the filesystem
  fs.unlink(filePath, (err) => {
    if (err) {
      console.error('Error deleting file:', err);
      return res.status(500).json({ message: 'Error deleting file' });
    }

    // Prepare SQL query to delete the entry from the database
    const query = 'DELETE FROM sliders WHERE file_path = ?';
    
    // Assuming the file path in DB matches the filename with the uploads directory
    const dbFilePath = `${fileName}`;

    db.query(query, [dbFilePath], (dbErr, result) => {
      if (dbErr) {
        console.error('Error deleting from database:', dbErr);
        return res.status(500).json({ message: 'Database error' });
      }

      res.json({ message: 'Slide deleted successfully' });
    });
  });
});




app.post('/update-settings', (req, res) => {
    const { whatsappLink, phoneNumber, commissionValue } = req.body;

    // Check if settings already exist
    const checkSql = 'SELECT COUNT(*) AS count FROM settings';
    
    db.query(checkSql, (err, results) => {
        if (err) {
            console.error('Error checking settings:', err);
            return res.status(500).json({ error: 'Failed to check settings.' });
        }

        const exists = results[0].count > 0;

        // If settings exist, update them; otherwise, insert the new settings
        const sql = exists
            ? `
                UPDATE settings SET 
                    whatsapp_link = ?, 
                    phone_number = ?, 
                    commission_value = ? 
                WHERE id = 1
            `
            : `
                INSERT INTO settings (whatsapp_link, phone_number, commission_value)
                VALUES (?, ?, ?)
            `;

        const values = exists
            ? [whatsappLink, phoneNumber, commissionValue]
            : [whatsappLink, phoneNumber, commissionValue];

        db.query(sql, values, (err, result) => {
            if (err) {
                console.error('Error saving settings:', err);
                return res.status(500).json({ error: 'Failed to save settings.' });
            }
            res.status(200).json({ message: 'Settings updated successfully.', result });
        });
    });
});





app.post('/admin/update-password', (req, res) => {
    const { oldPassword, newPassword, token } = req.body;

    // Check if the old password is correct
    const checkSql = 'SELECT password FROM admins WHERE token = ?';
    db.query(checkSql, [token], (err, results) => {
        if (err) {
            console.error('Error fetching admin:', err);
            return res.status(500).json({ error: 'Failed to fetch admin.' });
        }

        if (results.length === 0) {
            return res.status(404).json({ error: 'Admin not found.' });
        }

        const storedOldPassword = results[0].password;

        // Compare the old password
        if (oldPassword !== storedOldPassword) {
            return res.status(400).json({ error: 'Old password is incorrect.' });
        }

        // Update the password in the database
        const updateSql = 'UPDATE admins SET password = ? WHERE token = ?';
        db.query(updateSql, [newPassword, token], (err, result) => {
            if (err) {
                console.error('Error updating password:', err);
                return res.status(500).json({ error: 'Failed to update password.' });
            }

            res.status(200).json({ message: 'Password updated successfully.' });
        });
    });
});


// Route to get settings
app.get('/get-settings', (req, res) => {
    const sql = 'SELECT whatsapp_link, phone_number, commission_value FROM settings';

    db.query(sql, (err, results) => {
        if (err) {
            console.error('Error fetching settings:', err);
            return res.status(500).json({ error: 'Failed to fetch settings.' });
        }

        if (results.length > 0) {
            res.status(200).json(results); // Send all results as the settings object
        } else {
            res.status(404).json({ error: 'No settings found.' });
        }
    });
});




app.post('/api/services', upload.single('icon'), (req, res) => {
  const file = req.file;

  if (!file) {
    return res.status(400).json({ error: 'No icon uploaded' });
  }

  const { title, description, required_list, is_car_service , LinkWts , phone} = req.body;

  // Paths for temp and final destination
  const tempFilePath = path.join(__dirname, 'uploads', 'temp', file.filename);
  const iconsFilePath = path.join(__dirname, 'uploads', 'icons', file.filename);

  // Move the uploaded icon to the icons directory
  fs.rename(tempFilePath, iconsFilePath, (err) => {
    if (err) {
      console.error('Error moving file to icons directory:', err);
      return res.status(500).json({ error: 'Could not move file' });
    }

    const filePath = `${file.filename}`; // Store just the filename in the database

    // Prepare query to insert the service data into the database
    const query = `
      INSERT INTO services (title, description, icon, required_list, is_car_service , wtsLink , phone)
      VALUES (?, ?, ?, ?, ? ,? , ?)
    `;

    // Format required_list as a JSON string
    const formattedRequiredList = required_list ? JSON.stringify(required_list) : '[]';

    db.query(
      query,
      [title, description, filePath, formattedRequiredList, is_car_service , LinkWts , phone],
      (err, result) => {
        if (err) {
          console.error('Error inserting service data into database:', err);
          return res.status(500).json({ error: 'Database error' });
        }

        // Respond with success and the inserted service data
        res.json({
          service: {
            title,
            description,
            icon: filePath,
            required_list: JSON.parse(formattedRequiredList),
            is_car_service: is_car_service === 'true',
          },
        });
      }
    );
  });
});


app.put('/api/services/:id', upload.single('icon'), (req, res) => {
  const file = req.file;
  const serviceId = req.params.id; // Get the service ID from the route params
  const { title, description, required_list, is_car_service, LinkWts, phone } = req.body;

  // Paths for temp and final destination (if icon is provided)
  let iconsFilePath;
  if (file) {
    const tempFilePath = path.join(__dirname, 'uploads', 'temp', file.filename);
    iconsFilePath = path.join(__dirname, 'uploads', 'icons', file.filename);

    // Move the uploaded icon to the icons directory
    fs.rename(tempFilePath, iconsFilePath, (err) => {
      if (err) {
        console.error('Error moving file to icons directory:', err);
        return res.status(500).json({ error: 'Could not move file' });
      }
    });
  }

  // Format required_list as a JSON string
  const formattedRequiredList = required_list ? JSON.stringify(required_list) : '[]';

  // Prepare query to update the service data in the database
  let query = `
    UPDATE services 
    SET title = ?, description = ?, required_list = ?, is_car_service = ?, wtsLink = ?, phone = ?
  `;
  const values = [title, description, formattedRequiredList, is_car_service, LinkWts, phone];

  // If an icon is uploaded, include it in the update
  if (file) {
    query += `, icon = ?`;
    values.push(file.filename); // Store just the filename
  }

  query += ` WHERE service_id = ?`; // Update only the service with the given ID
  values.push(serviceId);

  db.query(query, values, (err, result) => {
    if (err) {
      console.error('Error updating service data:', err);
      return res.status(500).json({ error: err });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Service not found' });
    }

    // Respond with success and the updated service data
    res.json({
      service: {
        id: serviceId,
        title,
        description,
        icon: file ? file.filename : undefined, // Only include icon if updated
        required_list: JSON.parse(formattedRequiredList),
        is_car_service: is_car_service === 'true',
        LinkWts,
        phone,
      },
    });
  });
});



app.get('/places/buyOrRent/count', (req, res) => {
    const query = `
        SELECT 
            SUM(CASE WHEN buy_or_rent = 'للبيع' THEN 1 ELSE 0 END) AS forSaleCount,
            SUM(CASE WHEN buy_or_rent = 'للإيجار' THEN 1 ELSE 0 END) AS forRentCount,
            SUM(CASE WHEN buy_or_rent = 'الحجز' THEN 1 ELSE 0 END) AS reservationCount
        FROM places;
    `;

    db.query(query, (error, results) => {
        if (error) {
            return res.status(500).json({ error: 'Database error', details: error });
        }
        // Respond with the counts
        res.json({
            للبيع: results[0].forSaleCount,
            للإيجار: results[0].forRentCount,
            الحجز: results[0].reservationCount
        });
    });
});

app.get('/places/visits', (req, res) => {
    const query = `
        SELECT 
            DATE(date) AS visitDate, 
            COUNT(*) AS placeCount
        FROM places
        GROUP BY visitDate
        ORDER BY visitDate;
    `;

    db.query(query, (error, results) => {
        if (error) {
            return res.status(500).json({ error: 'Database error', details: error });
        }

        // Format the results into the format expected by the front end
        const labels = results.map(row => row.visitDate);
        const series = [{
            name: 'اعلانات',  // Ads in Arabic
            type: 'line',
            fill: 'solid',
            data: results.map(row => row.placeCount),
        }];

        // Respond with formatted data
        res.json({ labels, series });
    });
});
// Route to delete a service
app.delete('/api/services/:id', (req, res) => {
  const { id } = req.params;

  // First, find the service to get the icon file name
  const findServiceQuery = 'SELECT icon FROM services WHERE service_id = ?';
  db.query(findServiceQuery, [id], (err, result) => {
    if (err || result.length === 0) {
      console.error('Error finding service:', err);
      return res.status(500).json({ error: 'Service not found' });
    }

    const iconFileName = result[0].icon;
    const iconFilePath = path.join(__dirname, 'uploads', 'icons', iconFileName);

    // Delete the icon file from the server
    fs.unlink(iconFilePath, (err) => {
      if (err) {
        console.error('Error deleting icon file:', err);
      }
      
      // Proceed to delete the service from the database
      const deleteQuery = 'DELETE FROM services WHERE service_id = ?';
      db.query(deleteQuery, [id], (err, result) => {
        if (err) {
          console.error('Error deleting service from database:', err);
          return res.status(500).json({ error: 'Could not delete service' });
        }

        res.json({ message: 'Service deleted successfully' });
      });
    });
  });
});






app.get('/api/services', (req, res) => {
  const query = 'SELECT * FROM services ORDER BY created_at DESC';
  
  db.query(query, (err, results) => {
    if (err) {
      console.error('Error fetching services:', err);
      return res.status(500).json({ error: 'Database error' });
    }
    
    res.json({ services: results });
  });
});


app.get('/api/getOnce/services/:id', (req, res) => {
  const serviceId = req.params.id;

  // Query to get the service
  const query = 'SELECT * FROM services WHERE service_id = ?';
  db.query(query, [serviceId], (error, results) => {
    if (error) {
      return res.status(500).json({ error: 'Database query failed' });
    }

    if (results.length === 0) {
      return res.status(404).json({ error: 'Service not found' });
    }

    res.json(results[0]);
  });
});


app.get('/privacy', (req, res) => {
  const query = 'SELECT privacy_ar, privacy_en FROM settings LIMIT 1';

  db.query(query, (error, results) => {
    if (error) {
      return res.status(500).json({ error: 'Failed to retrieve privacy policies' });
    }
    if (results.length > 0) {
      return res.json({
        privacy_ar: results[0].privacy_ar,
        privacy_en: results[0].privacy_en
      });
    }
    res.status(404).json({ message: 'No privacy policies found' });
  });
});

// Route to get terms and conditions (terms_ar and terms_en)
app.get('/terms', (req, res) => {
  const query = 'SELECT terms_ar, terms_en FROM settings LIMIT 1';

  db.query(query, (error, results) => {
    if (error) {
      return res.status(500).json({ error: 'Failed to retrieve terms and conditions' });
    }
    if (results.length > 0) {
      return res.json({
        terms_ar: results[0].terms_ar,
        terms_en: results[0].terms_en
      });
    }
    res.status(404).json({ message: 'No terms and conditions found' });
  });
});

app.get('/services/car', (req, res) => {
  // Query to get services where `is_car_service` is 1
  const query = 'SELECT * FROM services WHERE is_car_service = 1';

  db.query(query, (error, results) => {
    if (error) {
      return res.status(500).json({ error: 'Database query failed' });
    }

    if (results.length === 0) {
      return res.status(404).json({ error: 'خدمة السيارات غير متوفرة بعد' });
    }

    res.json(results);
  });
});

// Start server
app.listen(port, () => {
  console.log(`Server started on port ${port}`);
});
