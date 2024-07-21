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
// Set up multer for file uploads
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
  host: "localhost",
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

// Register a new user with phone number
app.post("/register", (req, res) => {
  const { name, phone, password } = req.body;
  if (!name || !phone || !password) {
    return res.status(400).json({
      message: "Name, phone number, and password are required",
    });
  }
  const token = crypto.randomBytes(64).toString("hex");
  const sqlInsert =
    "INSERT INTO users (name, phone, password, phone_verified , session_token) VALUES (?, ?, ?, ? ,?)";
  const verificationCode = Math.floor(1000 + Math.random() * 9000).toString();
  const message = `Your verification code is ${verificationCode}`;

  db.query(sqlInsert, [name, phone, password, false, token], (err, result) => {
    if (err) {
      console.error(err);
      return res.status(500).json({
        message: "Internal server error",
        error: err,
      });
    }

    // Fetch the newly inserted user from the database
    const sqlSelect = "SELECT * FROM users WHERE id = ?";
    db.query(sqlSelect, [result.insertId], (err, userResult) => {
      if (err) {
        console.error(err);
        return res.status(500).json({
          message: "Internal server error",
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
                return res
                  .status(500)
                  .json({ message: "Internal server error", error: err });
              }
              // Return user data along with registration success message
              res.status(200).json({
                message: "User registered successfully.",
                user: registeredUser,
              });
            }
          );
        })
        .catch((error) => {
          console.log(error);
          res.status(500).json({
            message: "Failed to send verification code",
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
        message: "Phone number and password are required!",
      });
    }
  
    const sql = "SELECT * FROM users WHERE phone = ?";
    db.query(sql, [phone], (err, results) => {
      if (err) {
        console.error(err);
        return res.status(500).json({
          message: "Internal server error",
          error: err,
        });
      }
  
      if (results.length === 0 || results[0].password !== password) {
        return res.status(401).json({
          message: "Phone number or password is incorrect!",
        });
      }
  
      if (!results[0].phone_verified) {
        // Phone number not verified, send verification code again
        const verificationCode = Math.floor(1000 + Math.random() * 9000).toString();
        const message = `Your verification code is ${verificationCode}`;
        console.log("start send verification");
  
        sendVerificationCode(phone, message)
          .then((response) => {
            console.log(response);
  
            // Save verification code to database
            const sql = "UPDATE verifications SET code = ? WHERE phone = ?";
            db.query(sql, [verificationCode, phone], (err, result) => {
              if (err) {
                return res.status(500).json({ message: "Internal server error", error: err });
              }
              res.status(200).json({
                message: "Verification code sent again.",
                userId: results[0].id,
              });
            });
          })
          .catch((error) => {
            console.log("error");
  
            res.status(500).json({
              message: "Failed to send verification code",
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
            message: "Failed to update session token",
            error: updateErr,
          });
        }
  
        // Send the session token to the client
        res.status(200).json({
          message: "Login successful!",
          user: results[0],
          sessionToken: sessionToken,
        });
      });
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

    if (results.length === 0) {
      return res.status(400).json({ message: "Invalid verification code!" });
    }

    const updateSql = "UPDATE users SET phone_verified = true WHERE phone = ?";
    db.query(updateSql, [phone], (updateErr) => {
      if (updateErr) {
        console.error(updateErr);
        return res.status(500).json({ message: "Internal server error", error: updateErr });
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

app.post("/api/places/add", upload.array("images"), (req, res) => {
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
    adsAccept
  } = req.body;

  const addedPhotos = req.files; // Array of file objects

  // Generate unique directory name for each place using UUID
  const placeId = uuidv4();
  const folderName = placeId; // Assigning folderName to placeId

  const uploadDir = path.join(__dirname, 'uploads', folderName);

  // Create the directory if it doesn't exist
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }

  const savedPhotos = [];
  
  // Move uploaded photos to the unique directory
  addedPhotos.forEach((file, index) => {
    const oldPath = file.path; // Temporary path
    const newPath = path.join(uploadDir, `${index + 1}_${file.originalname}`); // Rename files if necessary

    try {
      fs.renameSync(oldPath, newPath);
      savedPhotos.push({
        originalName: file.originalname,
        savedAs: path.join(folderName, `${index + 1}_${file.originalname}`)
      });
    } catch (err) {
      console.error('Failed to move file:', err);
      return res.status(500).json({
        message: 'Internal server error',
        error: err.message
      });
    }
  });

  // SQL query to insert place details into database
  const sql = `
    INSERT INTO places (
      title, address, photos, description, perks, extra_info, max_guests, price, owner_id, folderName,
      type, sellingMethod, ownerPhone, home_type, farm_has_house, farm_has_water, farm_has_farmed,
      land_in_face_of_street, number_of_streets_in_land, space_general, number_of_home_stage, total_stages,
      number_of_rooms, buy_or_rent, rent_type, owner_status, location, amenities, hajez_days, hajez_type,
      variable_prices, publisher_state, ads_accept
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,?)
  `;

  db.query(
    sql,
    [
      title || null, address || null, savedPhotos.map(photo => photo.savedAs).join(',') || null, description || null, perks || null, extraInfo || null,
      maxGuests || null, price || null, ownerId || null, folderName || null, type || null, sellingMethod || null, ownerPhone || null,
      homeType || null, farmHasHouse || null, farmHasWater || null, farmHasFarmed || null, landInFaceOfStreet || null,
      numberOfStreetsInLand || null, spaceGeneral || null, numberOfHomeStage || null, totalStages || null, JSON.stringify(numberOfRooms) || null,
      buyOrRent || null, rentType || null, ownerStatus || null, location || null, JSON.stringify(amenities) || null, JSON.stringify(hajezDays) || null,
      hajezType || null, JSON.stringify(variablePrices) || null, publisherState || null, adsAccept || null
    ],
    (err, result) => {
      if (err) {
        console.log("Failed to add place:", err);
        return res.status(500).json({
          message: "Internal server error",
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

//   fetch posts Data

// Route to fetch all places
app.get("/api/places", (req, res) => {
  const sql = "SELECT * FROM places";
  console.log("api");
  // Execute SQL query
  db.query(sql, (err, results) => {
    if (err) {
      console.error("Error fetching places:", err);
      return res.status(500).json({ error: "Internal Server Error" });
    }
    const posts = results;
    res.json({
      places: posts.reverse(),
    });
  });
});

app.get("/api/places/:id", (req, res) => {
  const placeId = req.params.id;
  const sql = "SELECT * FROM places WHERE id = ?";

  db.query(sql, [placeId], (err, results) => {
    if (err) {
      console.error("Error fetching place:", err);
      return res.status(500).json({ error: "Internal Server Error" });
    }

    if (results.length === 0) {
      return res.status(404).json({ message: "Place not found" });
    }
    res.json(results[0]); // Assuming there is only one place with this ID
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

app.post("/api/bookings/add", (req, res) => {
  const {
    checkIn,
    checkOut,
    noOfGuests,
    name,
    phone,
    place,
    price,
    costumerId,
  } = req.body;
  // Validate the input
  if (
    !checkIn ||
    !checkOut ||
    !noOfGuests ||
    !name ||
    !phone ||
    !place ||
    !price ||
    !costumerId
  ) {
    return res.status(400).json({ error: "All fields are required" });
  }

  const bookingId = uuidv4(); // Generate a unique ID for the booking

  const sql = `
      INSERT INTO bookings (id, check_in, check_out, no_of_guests, name, phone, place_id, price , costumerId)
      VALUES (?, ?, ?, ?, ?, ?, ?, ? ,?)`;

  db.query(
    sql,
    [
      bookingId,
      checkIn,
      checkOut,
      noOfGuests,
      name,
      phone,
      place,
      price,
      costumerId,
    ],
    (err, result) => {
      if (err) {
        console.error("Error adding booking:", err);
        return res.status(500).json({ error: "Internal Server Error" });
      }
      res
        .status(200)
        .json({ message: "Booking added successfully", bookingId });
    }
  );
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

      console.log(bookingWithPlace);

      res.json(bookingWithPlace);
    });
  });
});

// Start server
app.listen(port, () => {
  console.log(`Server started on port ${port}`);
});
