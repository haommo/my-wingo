import type { HttpContextContract } from '@ioc:Adonis/Core/HttpContext'
import Manifest from "App/Models/Manifest";
import ManifestShipment from "App/Models/ManifestShipment";
import ManifestHistory from "App/Models/ManifestHistory";
import { schema, rules } from "@ioc:Adonis/Core/Validator";
const { v1: uuidv1 } = require("uuid");
import Database from "@ioc:Adonis/Lucid/Database"; 

export default class ManifestShipmentsController {
  public async index({ response }) {
    const manifestShipment = await Manifest.all();
    return response.ok({ manifestShipment });
  }

  public async store({ auth, request, response }: HttpContextContract) {
    let manifestId;
    const trx = await Database.transaction(); // Sử dụng Database.transaction để bắt đầu transaction

    try {
      // Xác định schema cho việc validate payload
      const manifestSchema = schema.create({
        airway_bill_number: schema.string({ trim: true }, [rules.maxLength(255)]),
        airline: schema.string({ trim: true }, [rules.maxLength(255)]),
        country: schema.string({ trim: true }, [rules.maxLength(255)]),
        status: schema.string({ trim: true }, [rules.maxLength(255)]),
        total_hawb: schema.string({ trim: true }, [rules.maxLength(255)]),
        total_gross_weight: schema.string({ trim: true }, [rules.maxLength(255)]),
        total_charge_weight: schema.string({ trim: true }, [rules.maxLength(255)]),
      });

      // Validate payload từ request
      const payload = await request.validate({ schema: manifestSchema });
      const uniqueIdInt = Math.floor(1000000000 + Math.random() * 9000000000).toString();
      payload.manifest_id = uniqueIdInt;
      payload.created_by = auth.user.uuid;
      payload.date = request.input("date");

      // Tạo Manifest mới
      const manifest = await Manifest.create(payload, { client: trx });
      manifestId = manifest.id;
      
      // Tạo các ListShipments liên quan
      const listShipmentsArray = JSON.parse(request.input("list_shipments"));

      for (const item of listShipmentsArray) {
        await ManifestShipment.create({
          uuid: uuidv1(),
          manifest_id: manifest.manifest_id,
          hawb: item.hawb,
          receiver_name: item.receiver_name,
          gross_weight: item.gross_weight,
          volume_weight: item.volume_weight,
          charge_weight: item.charge_weight,
        }, { client: trx });
      }

      // Commit transaction nếu không có lỗi xảy ra
      await trx.commit();

      return response.ok({ manifest });
    } catch (error) {
      // Rollback transaction nếu có lỗi xảy ra
      await trx.rollback();
      console.error("Error creating manifest:", error);
      return response.status(500).send({ message: "Failed to create manifest." });
    }
  } 

  public async show({ params, response }: HttpContextContract) {
    const manifest = await Manifest.query()
      .where('manifest_id', params.id)
      .preload('shipments') 
      .preload('histories') 
      .first();
    if (!manifest) {
      return response.notFound({ message: "Manifest not found" });
    }
    return response.ok({
      manifest_Shipment: manifest,
      list_shipments: manifest.shipments,
      Manifest_History: manifest.histories,
    });
  }

public async update({ request, params, response }: HttpContextContract) {
  // Xác định schema cho việc validate payload cho Manifest
  const manifestSchema = schema.create({
    airway_bill_number: schema.string({ trim: true }, [rules.maxLength(255)]),
    airline: schema.string({ trim: true }, [rules.maxLength(255)]),
    country: schema.string({ trim: true }, [rules.maxLength(255)]),
    status: schema.string({ trim: true }, [rules.maxLength(255)]),
    total_hawb: schema.string({ trim: true }, [rules.maxLength(255)]),
    total_gross_weight: schema.string({ trim: true }, [rules.maxLength(255)]),
    total_charge_weight: schema.string({ trim: true }, [rules.maxLength(255)]),
  });

  // Validate payload từ request
  const payload = await request.validate({
    schema: manifestSchema,
  });

  // Lấy ngày từ request
  payload.date = request.input("date");

  // Tìm Manifest bằng manifest_id
  const manifest = await Manifest.findBy("manifest_id", params.id);

  if (!manifest) {
    return response.notFound({ message: "Manifest not found" });
  }

  // Cập nhật các thuộc tính của Manifest
  manifest.merge(payload);
  await manifest.save();

  // Xóa tất cả các ManifestShipments và ManifestHistories liên quan
  await ManifestShipment.query().where("manifest_id", params.id).delete();
  await ManifestHistory.query().where("manifest_id", params.id).delete();

  // Lấy danh sách các lô hàng từ request và lưu vào cơ sở dữ liệu
  const listShipmentsInput = request.input("list_shipments");
  if (listShipmentsInput) {
    const listShipmentsArray = JSON.parse(listShipmentsInput);
    for (const item of listShipmentsArray) {
      await ManifestShipment.create({
        uuid: uuidv1(),
        manifest_id: params.id,
        hawb: item.hawb,
        receiver_name: item.receiver_name,
        gross_weight: item.gross_weight,
        volume_weight: item.volume_weight,
        charge_weight: item.charge_weight,
      });
    }
  }

  // Lấy danh sách lịch sử từ request và lưu vào cơ sở dữ liệu
  const manifestHistoryInput = request.input("Manifest_history");
  if (manifestHistoryInput) {
    const manifestHistoryArray = JSON.parse(manifestHistoryInput);
    for (const item of manifestHistoryArray) {
      await ManifestHistory.create({
        uuid: uuidv1(),
        manifest_id: params.id,
        date: item.date,
        flight: item.flight,
        detail: item.detail,
        location: item.location,
        manifest_status: item.manifest_status,
      });
    }
  }

  return response.ok({
    message: "Manifest updated successfully",
    manifest,
  });
}

  public async destroy({ params, response }: HttpContextContract) {
    const manifest = await Manifest.findBy("manifest_id", params.id);
    if (!manifest) {
      return response.notFound({ message: "Manifest not found" });
    }
    await ManifestShipment.query().where("manifest_id", params.id).delete();
    await ManifestHistory.query().where("manifest_id", params.id).delete();
    await manifest.delete();
    return response.ok({ message: "Manifest and related data deleted successfully." });
  }

}
